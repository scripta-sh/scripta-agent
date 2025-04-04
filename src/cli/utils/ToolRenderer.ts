/**
 * CLI-specific Tool renderer interface
 * This defines UI-specific methods for rendering tools in the CLI
 */

import React from 'react';
import { CoreTool, ToolUseContext } from '../../core/utils/CoreTool.js';

/**
 * CLI-specific Tool interface that extends CoreTool with UI methods
 */
export interface CliTool extends CoreTool {
  prompt: (options: { dangerouslySkipPermissions: boolean }) => Promise<string>;
  userFacingName: (input: any) => string | React.ReactNode;
  
  renderResultForAssistant?: (data: any) => any;
}

/**
 * Factory function to create a CLI tool from a core tool
 */
export function createCliTool(coreTool: CoreTool, uiMethods: {
  prompt: (options: { dangerouslySkipPermissions: boolean }) => Promise<string>;
  userFacingName: (input: any) => string | React.ReactNode;
  renderResultForAssistant?: (data: any) => any;
}): CliTool {
  return {
    ...coreTool,
    ...uiMethods
  };
}
