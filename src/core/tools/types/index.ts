/**
 * Core tools type definitions
 */

import * as React from 'react';
import * as z from 'zod';

// Re-export all type definitions
export * from './notebook';

/**
 * Tool use context interface
 */
export interface ToolUseContext {
  uuid: string;
  messageUuid: string;
  cwd: string;
  auth?: {
    apiToken?: string;
  };
  dangerouslySkipPermissions?: boolean;
  abortSignal?: AbortSignal;
  setToolJSX?: (toolJSX: { jsx: React.ReactNode, shouldHidePromptInput: boolean } | null) => void;
  [key: string]: any;
}

/**
 * Result from a tool validation
 */
export interface ValidationResult {
  isValid: boolean;
  errors?: string[];
  inputWithDefaults?: any;
}

/**
 * Core tool interface
 * This is the main interface that all tools must implement
 */
export interface Tool {
  name: string;
  description: string | ((input: any) => Promise<string>);
  inputSchema: z.ZodObject<any>;
  inputJSONSchema?: string;
  
  // UI methods
  prompt: (options: { dangerouslySkipPermissions: boolean }) => Promise<string>;
  userFacingName: (input: any) => string | React.ReactNode;
  
  // Tool capability methods
  isEnabled?: () => Promise<boolean>;
  isReadOnly?: () => boolean;
  needsPermissions?: () => boolean;
  
  // Validation and execution
  validateInput: (input: any) => Promise<ValidationResult>;
  call: (input: any, context: ToolUseContext) => Promise<any>;
  
  // Rendering helpers
  renderResultForAssistant?: (input: any, data: any) => string | null;
}