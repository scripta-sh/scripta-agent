/**
 * Tool interface definition
 * This defines the contract that all tools must implement
 */

import * as z from 'zod';
import React from 'react';

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
 * Core Tool interface
 * All tools must implement this interface
 */
export interface Tool {
  // Basic properties
  name: string;
  description: string | ((input: any) => Promise<string>);
  inputSchema: z.ZodObject<any>;
  inputJSONSchema?: Record<string, unknown>;
  
  // UI methods
  prompt: (options: { dangerouslySkipPermissions: boolean }) => Promise<string>;
  userFacingName: (input: any) => string | React.ReactNode;
  
  // Tool capability methods
  isEnabled?: () => Promise<boolean>;
  isReadOnly?: () => boolean;
  needsPermissions?: (input: any) => boolean;
  
  // Validation and execution methods
  validateInput?: (input: any, context: ToolUseContext) => Promise<{ 
    result: boolean; 
    message?: string; 
    meta?: Record<string, any> 
  }>;
  call: (input: any, context: ToolUseContext) => AsyncGenerator<{
    type: string;
    data: any;
  }, any, unknown>;
  
  // Rendering method
  renderResultForAssistant?: (data: any) => any;
}