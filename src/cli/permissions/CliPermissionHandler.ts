import * as React from 'react';
import { Tool } from '../../Tool';
import { IPermissionHandler, PermissionRequest, PermissionHandlerContext } from '../../core/permissions/IPermissionHandler';
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
import { getGlobalConfig } from '../../utils/config'; // Fixed from @/ to relative path
import { FileEditTool } from '../../tools/FileEditTool/FileEditTool'; // Fixed from @/ to relative path
import { FileWriteTool } from '../../tools/FileWriteTool/FileWriteTool'; // Fixed from @/ to relative path
import { NotebookEditTool } from '../../tools/NotebookEditTool/NotebookEditTool'; // Fixed from @/ to relative path
import { randomUUID } from 'crypto';

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

// Define the type for the state setter function
type SetPermissionRequestFn = (
    request: PermissionRequest | null
) => void;

/**
 * CLI-specific implementation of IPermissionHandler.
 * Interacts with the REPL state to show permission prompts.
 */
export class CliPermissionHandler implements IPermissionHandler {
  private setToolUseConfirm: SetState<ToolUseConfirm | null>;
  private setPermissionRequest: SetPermissionRequestFn;
  // Track tools that have been granted session-wide permission (not just once)
  private sessionGrantedTools: Map<string, Set<string>> = new Map();
  
  constructor(setToolUseConfirm: SetState<ToolUseConfirm | null>, setPermissionRequest: SetPermissionRequestFn) {
    this.setToolUseConfirm = setToolUseConfirm;
    this.setPermissionRequest = setPermissionRequest;
  }
  
  // Generate a key for the session permission cache
  private getSessionPermissionKey(tool: Tool, input: any): string {
    try {
      // For write tools, use the file path as part of the key
      if (tool === FileWriteTool) {
        return `${tool.name}:${input.file_path || ''}`;
      }
      // For edit tools, use the file path as part of the key
      if (tool === FileEditTool) {
        return `${tool.name}:${input.file_path || ''}`;
      }
      // For notebook edit tools, use the notebook path
      if (tool === NotebookEditTool) {
        return `${tool.name}:${input.notebook_path || ''}`;
      }
      // For other tools, just use the tool name
      return tool.name;
    } catch (e) {
      // If we can't generate a key, just use the tool name
      return tool.name;
    }
  }
  
  // Check if session-wide permission has been granted for this specific tool invocation
  private hasSessionPermission(tool: Tool, input: any): boolean {
    // Get all granted paths for this tool
    const toolGranted = this.sessionGrantedTools.get(tool.name);
    if (!toolGranted) return false;
    
    // Check if the specific path is granted
    const permKey = this.getSessionPermissionKey(tool, input);
    return toolGranted.has(permKey);
  }
  
  // Grant session-wide permission for this specific tool invocation
  private grantSessionPermission(tool: Tool, input: any): void {
    const permKey = this.getSessionPermissionKey(tool, input);
    
    // Get or create the set for this tool
    if (!this.sessionGrantedTools.has(tool.name)) {
      this.sessionGrantedTools.set(tool.name, new Set());
    }
    
    // Add the permission key to the set
    this.sessionGrantedTools.get(tool.name)!.add(permKey);
  }

  async checkPermission(
    tool: Tool,
    input: any,
    context: PermissionHandlerContext
  ): Promise<boolean> {
    console.log(`[CliPermissionHandler] Checking permission for ${tool.name}`);
    // 1. Always allow if dangerouslySkipPermissions is set
    if (context.options.dangerouslySkipPermissions) {
      console.log(`[CliPermissionHandler] Skipping check due to dangerouslySkipPermissions`);
      return true;
    }
    
    // Check if this specific invocation has session-wide permission
    if (this.hasSessionPermission(tool, input)) {
      console.log(`[CliPermissionHandler] Found session permission for ${tool.name}`);
      
      // Make sure filesystem-level permission is also granted for file tools
      if (tool === FileWriteTool || tool === FileEditTool || tool === NotebookEditTool) {
        console.log(`[CliPermissionHandler] Granting filesystem permission for ${tool.name}`);
        // Use the savePermission that's already imported at the top
        savePermission(tool, input, null);
      }
      
      return true;
    }

    // 2. Check permanent grants from config
    const permissionCheckResult = await hasPermissionsToUseTool(tool, input, context, null);
    
    if (permissionCheckResult.result) {
      console.log(`[CliPermissionHandler] Found existing permission for ${tool.name} via hasPermissionsToUseTool`);
      return true;
    }

    console.log(`[CliPermissionHandler] No pre-existing permission found for ${tool.name}`);
    return false;
  }

  async requestPermission(
    tool: Tool,
    input: any,
    context: PermissionHandlerContext,
    assistantMessage?: AssistantMessage
  ): Promise<boolean> {
    console.log(`[CliPermissionHandler] Requesting permission for ${tool.name}`);
    // Create a placeholder assistant message if one isn't provided
    const placeholderAssistantMessage: AssistantMessage = assistantMessage || {
      type: 'assistant',
      message: {
        id: 'placeholder-message-id',
        role: 'assistant',
        content: [{ type: 'text', text: 'The assistant wants to use a tool.' }],
        model: '',
        usage: { input_tokens: 0, output_tokens: 0 },
        stop_reason: undefined,
        stop_sequence: undefined,
      },
      costUSD: 0,
      durationMs: 0,
      uuid: randomUUID() // Add the required uuid property
    };
    
    // Re-implementing the core logic from the original class using setToolUseConfirm
    return new Promise(async (resolve) => {
      const handleAbort = () => {
        context.abortController.abort();
        resolve(false);
      };

      if (context.abortController.signal.aborted) {
        handleAbort();
        return;
      }

      try {
        // Fetch description etc. (may need adjustments based on Tool structure)
        const description = tool.description && typeof tool.description === 'function'
          ? await tool.description(input)
          : tool.description ?? tool.name;
        // commandPrefix logic might need adjustment or removal if not used
        const commandPrefix = null; 

        this.setToolUseConfirm({
          assistantMessage: placeholderAssistantMessage,
          tool,
          description,
          input,
          commandPrefix,
          riskScore: null,
          onAbort: () => {
            this.setToolUseConfirm(null);
            handleAbort();
          },
          onAllow: async (type: 'once' | 'permanent') => {
            this.setToolUseConfirm(null);
            
            // Save to the session cache only if user chose "don't ask again this session"
            if (type === 'permanent') {
              console.log(`[CliPermissionHandler] Granting session-wide permission for ${tool.name}`);
              this.grantSessionPermission(tool, input);
            }
            
            // Always save filesystem permission for the current request
            if (tool === FileWriteTool || tool === FileEditTool || tool === NotebookEditTool) {
              console.log(`[CliPermissionHandler] Granting filesystem permission for current request: ${tool.name}`);
              savePermission(tool, input, null);
            }
            
            resolve(true);
          },
          onReject: () => {
            this.setToolUseConfirm(null);
            handleAbort(); // Aborting is handled within handleAbort now
          },
        });
      } catch (error) {
        console.error("Error during permission request setup:", error);
        handleAbort(); // Treat errors as denials/aborts
      }
    });
  }
} 