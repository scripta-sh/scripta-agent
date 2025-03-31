import * as React from 'react';
import { getToolRenderer } from './getToolRenderer';
import { getTheme } from '../../utils/theme';
import { ToolRenderContext } from '../../types/tool-ui';

// Export common components
export { ToolResultContainer } from './common/ToolResultContainer';
export { OutputLine } from './common/OutputLine';

// Export tool renderer interfaces and functions
export type { ToolRenderer } from './ToolRenderer';
export { registerToolRenderer, registerCategoryRenderer } from './getToolRenderer';

/**
 * Renders the tool use message when a tool is invoked
 * Legacy compatibility function for existing code
 */
export function renderToolUseMessage(toolName: string, input: any, verbose: boolean): React.ReactNode {
  const context: ToolRenderContext = {
    verbose,
    columns: process.stdout.columns || 80
  };
  
  const renderer = getToolRenderer(toolName);
  return renderer.renderToolUse(input, context);
}

/**
 * Renders the tool result message when a tool completes
 * Legacy compatibility function for existing code
 */
export function renderToolResultMessage(toolName: string, data: any, verbose: boolean): React.ReactNode {
  const context: ToolRenderContext = {
    verbose,
    columns: process.stdout.columns || 80
  };
  
  const renderer = getToolRenderer(toolName);
  return renderer.renderToolResult(data, context);
}

/**
 * Renders the tool rejected message when a tool use is rejected
 * Legacy compatibility function for existing code
 */
export function renderToolUseRejectedMessage(
  toolName: string, 
  input: any, 
  context: { columns: number, verbose: boolean }
): React.ReactNode {
  const renderContext: ToolRenderContext = {
    ...context
  };
  
  const renderer = getToolRenderer(toolName);
  return renderer.renderToolRejected(input, renderContext);
}