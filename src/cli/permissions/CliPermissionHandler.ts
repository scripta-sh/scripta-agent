import * as React from 'react';
import { Tool } from '../../Tool';
import { IPermissionHandler, PermissionHandlerContext } from '../../core/permissions/IPermissionHandler';
import {
  hasPermissionsToUseTool,
  savePermission,
  bashToolHasPermission,
} from '../../permissions';
import { ToolUseConfirm } from '../../components/permissions/PermissionRequest';
import { AssistantMessage } from '../../query'; // Needed for ToolUseConfirm type
import { logEvent } from '../../services/statsig';
import { REJECT_MESSAGE } from '../../utils/messages';
import { BashTool, inputSchema as bashInputSchema } from '../../tools/BashTool/BashTool';
import { getCommandSubcommandPrefix } from '../../utils/commands';
import { AbortError } from '../../utils/errors';

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

/**
 * CLI-specific implementation of IPermissionHandler.
 * Interacts with the REPL state to show permission prompts.
 */
export class CliPermissionHandler implements IPermissionHandler {
  private setToolUseConfirm: SetState<ToolUseConfirm | null>;
  // We might need access to the assistant message that triggered the tool use
  // to pass it to the PermissionRequest component. This could be tricky.
  // Let's assume context might provide it, or we simplify the prompt for now.

  constructor(setToolUseConfirm: SetState<ToolUseConfirm | null>) {
    this.setToolUseConfirm = setToolUseConfirm;
  }

  async checkPermission(
    tool: Tool,
    input: any,
    context: PermissionHandlerContext,
  ): Promise<boolean> {
    // Replicates the initial check from useCanUseTool/hasPermissionsToUseTool
    // Note: hasPermissionsToUseTool requires assistantMessage, which we might not have here.
    // We need to adapt the logic slightly or find a way to pass the message.
    // For now, let's focus on the core logic based on `permissions.ts`.

    // If permissions are being skipped globally
    if (context.options.dangerouslySkipPermissions) {
      return true;
    }

    // Check if the tool itself declares it needs permissions for this input
    try {
      if (!tool.needsPermissions || !tool.needsPermissions(input)) {
        return true;
      }
    } catch (e) {
      console.error(`Error checking tool.needsPermissions: ${e}`);
      return false; // Fail closed if needsPermissions check throws
    }

    // At this point, the tool *says* it needs permission. Check config.
    // This logic might need refinement based on exactly how hasPermissionsToUseTool checks config.
    // TODO: Refine this check based on permissions.ts logic (getPermissionKey, allowedTools)
    // const projectConfig = getCurrentProjectConfig(); // Need access to config
    // const allowedTools = projectConfig.allowedTools ?? [];
    // const permissionKey = getPermissionKey(tool, input, null); // Need getPermissionKey
    // if (allowedTools.includes(permissionKey)) return true;
    // if (tool === BashTool && allowedTools.includes(BashTool.name)) return true;

    // Placeholder: Assume if tool.needsPermissions(input) is true, we don't have pre-granted permission yet.
    // The original hasPermissionsToUseTool had more complex logic involving config files.
    // We'll rely on requestPermission to handle the user interaction if this returns false.
    console.warn('[CliPermissionHandler] checkPermission simplified, relying on requestPermission');
    return false;
  }

  async requestPermission(
    tool: Tool,
    input: any,
    context: PermissionHandlerContext,
    assistantMessage: AssistantMessage,
  ): Promise<boolean> {
    // Replicates the prompting logic from useCanUseTool
    return new Promise(async (resolve) => {

      const logToolUseEvent = (eventName: string) => {
         // Use the passed assistantMessage
         logEvent(eventName, {
            toolName: tool.name,
            messageID: assistantMessage.message.id // <-- Use ID from param
          });
      };

      const handleAbort = () => {
        logToolUseEvent('tengu_tool_use_cancelled');
        logToolUseEvent('tengu_tool_use_rejected_in_prompt'); // Treat abort as rejection
        context.abortController.abort(); // Abort other operations
        resolve(false);
      };

      if (context.abortController.signal.aborted) {
        handleAbort();
        return;
      }

      try {
         // Fetch description and prefix (only needed for BashTool display)
         const description = tool.description && typeof tool.description === 'function'
            ? await tool.description(input)
            : tool.description ?? tool.name;

         const commandPrefix = tool.name === BashTool.name
            ? await getCommandSubcommandPrefix(
                bashInputSchema.parse(input).command,
                context.abortController.signal,
              )
            : null;

         if (context.abortController.signal.aborted) {
           handleAbort();
           return;
         }

         // Trigger the UI prompt via REPL state
         this.setToolUseConfirm({
           assistantMessage, // <-- Use the passed message directly
           tool,
           description,
           input,
           commandPrefix,
           riskScore: null, // Assuming null for now
           onAbort: () => {
             this.setToolUseConfirm(null); // Clear the prompt
             handleAbort();
           },
           onAllow: async (type) => {
             this.setToolUseConfirm(null); // Clear the prompt
             if (type === 'permanent') {
               logToolUseEvent('tengu_tool_use_granted_in_prompt_permanent');
               try {
                 // Save permanent permission (potentially needs prefix for Bash)
                 const prefixToSave = tool.name === BashTool.name ? commandPrefix?.commandPrefix ?? null : null;
                 await savePermission(tool, input, prefixToSave);
               } catch(e) {
                  console.error("Error saving permission:", e);
               }
             } else {
               logToolUseEvent('tengu_tool_use_granted_in_prompt_temporary');
             }
             resolve(true); // Permission granted
           },
           onReject: () => {
             this.setToolUseConfirm(null); // Clear the prompt
             logToolUseEvent('tengu_tool_use_rejected_in_prompt');
             context.abortController.abort(); // Rejecting one tool aborts the sequence
             resolve(false); // Permission denied
           },
         });
      } catch (error) {
         console.error("Error during permission request setup:", error);
         if (error instanceof AbortError) {
             handleAbort();
         } else {
            // For other errors, deny permission and clear prompt
            this.setToolUseConfirm(null);
            resolve(false);
         }
      }
    });
  }
} 