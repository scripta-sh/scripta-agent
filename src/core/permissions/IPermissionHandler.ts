import { Tool } from '../../Tool';
import { AssistantMessage } from '../agent';

// Define a simpler context for permission handling
export type PermissionHandlerContext = {
  abortController: AbortController;
  options: {
    dangerouslySkipPermissions?: boolean;
    // Add other relevant options if needed later
  };
  // Add other context properties if needed
};

/**
 * Permission request interface for UI interaction
 */
export interface PermissionRequest {
  tool: Tool;
  input: any;
  onAllow: (type: 'once' | 'permanent') => void;
  onReject: () => void;
}

/**
 * Interface for handling permission checks and requests for tool usage.
 */
export interface IPermissionHandler {
  /**
   * Checks if permission for a specific tool use already exists (e.g., granted
   * previously for the session or matching a pre-approved pattern/prefix).
   *
   * @param tool The tool requesting permission.
   * @param input The input provided to the tool.
   * @param context The context in which the tool is being used.
   * @returns Promise<boolean> True if permission is already granted, false otherwise.
   */
  checkPermission(
    tool: Tool,
    input: any,
    context: PermissionHandlerContext
  ): Promise<boolean>;

  /**
   * Actively requests permission from the user (e.g., via CLI prompt) or
   * checks against configured policies/scopes (e.g., in an API context).
   *
   * @param tool The tool requesting permission.
   * @param input The input provided to the tool.
   * @param context The context in which the tool is being used.
   * @param assistantMessage Optional: The assistant message associated with the request.
   * @returns Promise<boolean> True if permission is granted, false if denied.
   */
  requestPermission(
    tool: Tool,
    input: any,
    context: PermissionHandlerContext,
    assistantMessage?: AssistantMessage
  ): Promise<boolean>;
} 