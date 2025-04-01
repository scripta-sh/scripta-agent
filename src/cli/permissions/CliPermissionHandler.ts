import * as React from 'react';
import { Tool } from '../../core/tools/interfaces/Tool';
import { IPermissionHandler, PermissionRequest, PermissionHandlerContext } from '../../core/permissions/IPermissionHandler';
import {
  hasPermissionsToUseTool,
  savePermission,
  bashToolHasPermission,
} from '../../permissions';
import { ToolUseConfirm } from '../components/permissions/PermissionRequest';
import { AssistantMessage } from '../../core/agent';
import { logEvent } from '../../services/statsig';
import { REJECT_MESSAGE } from '../../utils/messages';
import { getCommandSubcommandPrefix } from '../../utils/commands';
import { AbortError } from '../../utils/errors';
import { getGlobalConfig } from '../../utils/config';
// Import tools from core
import { FileEditTool } from '../../core/tools/filesystem';
import { FileWriteTool } from '../../core/tools/filesystem';
import { NotebookEditTool } from '../../core/tools/notebook';
import { randomUUID } from 'crypto';
import { createComponentLogger } from '../../utils/log';

// Create a logger instance
const logger = createComponentLogger('CliPermissionHandler');

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

// Define the type for the state setter function for the simple prompt
// Re-define the type needed for the simple prompt state setter
interface SimplePermissionRequest {
    toolName: string;
    toolInput: any;
    onAllow: () => void;
    onDeny: () => void;
}
type SetSimplePermissionRequestFn = (request: SimplePermissionRequest | null) => void;

/**
 * CLI-specific implementation of IPermissionHandler.
 * Interacts with the REPL state to show permission prompts.
 */
export class CliPermissionHandler implements IPermissionHandler {
  private setToolUseConfirm: SetState<ToolUseConfirm | null>;
  private setPermissionRequest: SetSimplePermissionRequestFn; // <-- Use explicit type
  // Track tools that have been granted session-wide permission (not just once)
  private sessionGrantedTools: Map<string, Set<string>> = new Map();
  
  constructor(
      setToolUseConfirm: SetState<ToolUseConfirm | null>, 
      setPermissionRequest: SetSimplePermissionRequestFn // <-- Use explicit type
  ) {
    this.setToolUseConfirm = setToolUseConfirm;
    this.setPermissionRequest = setPermissionRequest;
  }
  
  // Generate a key for the session permission cache
  private getSessionPermissionKey(tool: Tool, input: any): string {
    try {
      // Check tool name for specific handling
      if (tool.name === 'FileWrite') {
        return `${tool.name}:${input.file_path || ''}`;
      }
      if (tool.name === 'FileEdit') {
        return `${tool.name}:${input.file_path || ''}`;
      }
      if (tool.name === 'NotebookEdit') {
        return `${tool.name}:${input.notebook_path || ''}`;
      }
      return tool.name;
    } catch (e) {
      return tool.name;
    }
  }
  
  // Check if session-wide permission has been granted for this specific tool invocation
  private hasSessionPermission(tool: Tool, input: any): boolean {
    // Check tool name for specific handling
    if (tool.name === 'FileWrite' || tool.name === 'FileEdit' || tool.name === 'NotebookEdit') {
      return false;
    }
    
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
    logger.debug(`Checking permission for ${tool.name}`);
    // 1. Always allow if dangerouslySkipPermissions is set
    if (context.options.dangerouslySkipPermissions) {
      logger.debug(`Skipping check due to dangerouslySkipPermissions`);
      return true;
    }
    
    // Check if this specific invocation has session-wide permission
    if (this.hasSessionPermission(tool, input)) {
      logger.debug(`Found session permission for ${tool.name}`);
      
      // Make sure filesystem-level permission is also granted for file tools
      if (tool.name === 'FileWrite' || tool.name === 'FileEdit' || tool.name === 'NotebookEdit') {
        logger.debug(`Granting filesystem permission for ${tool.name}`);
        // Use the savePermission that's already imported at the top
        savePermission(tool, input, null);
      }
      
      return true;
    }

    // 2. Check permanent grants from config
    const permissionCheckResult = await hasPermissionsToUseTool(tool, input, context, null);
    
    if (permissionCheckResult.result) {
      logger.debug(`Found existing permission for ${tool.name} via hasPermissionsToUseTool`);
      return true;
    }

    logger.debug(`No pre-existing permission found for ${tool.name}`);
    return false;
  }

  async requestPermission(
    tool: Tool,
    input: any,
    context: PermissionHandlerContext,
    assistantMessage?: AssistantMessage
  ): Promise<boolean> {
    logger.debug(`Requesting permission for ${tool.name}`);
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
    
    return new Promise(async (resolve) => {
      const handleAbort = () => {
        // context.abortController.abort(); // No longer have controller here
        resolve(false);
      };

      // Check the signal directly
      if (context.abortSignal.aborted) {
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

        /* --- COMMENT OUT SETTING THE SIMPLE PERMISSION REQUEST --- 
        // Set the permission request using the correct interface structure
        const userFacingName = tool.userFacingName ? tool.userFacingName(input) : tool.name;
        logger.debug(`Setting permission request for ${userFacingName}`);
        this.setPermissionRequest({
          toolName: userFacingName, 
          toolInput: input,
          onAllow: () => {
            logger.debug(`Permission request allowed by user`);
            this.setPermissionRequest(null);
            // Also clear the detailed confirm state
            this.setToolUseConfirm(null); 
            
            // Save permission based on tool type (existing logic)
            if (tool.name === 'FileWrite' || tool.name === 'FileEdit' || tool.name === 'NotebookEdit') {
              logger.debug(`Granting filesystem permission for current request: ${tool.name}`);
              savePermission(tool, input, null);
            }
            resolve(true);
          },
          onDeny: () => {
            logger.debug(`Permission request denied by user`);
            this.setPermissionRequest(null);
            // Also clear the detailed confirm state
            this.setToolUseConfirm(null); 
            handleAbort();
          }
        });
        */

        // Set ONLY the detailed tool use confirmation state
        logger.debug(`Setting ToolUseConfirm state for ${tool.name}`);
        this.setToolUseConfirm({
          assistantMessage: placeholderAssistantMessage,
          tool,
          description,
          input,
          commandPrefix,
          riskScore: null,
          onAbort: () => {
            this.setToolUseConfirm(null);
            this.setPermissionRequest(null); // Also clean up permission request
            // Abort is handled by checking the signal elsewhere or if the promise rejects naturally
            // We don't call handleAbort() here directly anymore unless needed by UI logic
            resolve(false); // Resolve false on explicit UI abort
          },
          onAllow: async (type: 'once' | 'permanent') => {
            this.setToolUseConfirm(null);
            this.setPermissionRequest(null); // Also clean up permission request
            
            // Save to the session cache only if user chose "don't ask again this session"
            if (type === 'permanent') {
              logger.debug(`Granting session-wide permission for ${tool.name}`);
              this.grantSessionPermission(tool, input);
            }
            
            // Always save filesystem permission for the current request
            if (tool.name === 'FileWrite' || tool.name === 'FileEdit' || tool.name === 'NotebookEdit') {
              logger.debug(`Granting filesystem permission for current request: ${tool.name}`);
              savePermission(tool, input, null);
            }
            
            resolve(true);
          },
          onReject: () => {
            this.setToolUseConfirm(null);
            this.setPermissionRequest(null); // Also clean up permission request
            // handleAbort(); // Don't call abort here, just resolve false
            resolve(false);
          },
        });
      } catch (error) {
        logger.error("Error during permission request setup:", error);
        this.setPermissionRequest(null); // Clean up on error
        handleAbort(); // Treat errors as denials/aborts
      }
    });
  }
} 