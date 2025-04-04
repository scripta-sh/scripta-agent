/**
 * Core Tool interface definition
 * This defines the contract that all tools must implement without UI dependencies
 */

import * as z from 'zod';
import { AbortSignal } from 'node-abort-controller';

/**
 * Context object passed to tool calls
 */
export interface ToolUseContext {
  uuid: string;
  messageUuid: string;
  cwd: string;
  abortSignal: AbortSignal;
  auth?: {
    apiToken?: string;
  };
  dangerouslySkipPermissions?: boolean;
  [key: string]: any;
}

/**
 * Core Tool interface without UI dependencies
 * All tools must implement this interface
 */
export interface CoreTool {
  name: string;
  description: string | ((input: any) => Promise<string>);
  inputSchema: z.ZodObject<any>;
  inputJSONSchema?: Record<string, unknown>;
  
  isEnabled?: () => Promise<boolean>;
  isReadOnly?: () => boolean;
  needsPermissions?: (input: any) => boolean;
  
  validateInput?: (input: any, context: ToolUseContext) => Promise<{ 
    result: boolean; 
    message?: string; 
    meta?: Record<string, any> 
  }>;
  call: (input: any, context: ToolUseContext) => AsyncGenerator<{
    type: string;
    data: any;
  }, any, unknown>;
}
