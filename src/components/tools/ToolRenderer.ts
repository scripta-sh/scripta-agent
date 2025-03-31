import * as React from 'react';
import { ToolRenderContext } from '../../types/tool-ui';

/**
 * Interface for tool-specific renderers
 * Each tool implements this interface to provide UI rendering
 */
export interface ToolRenderer<TInput = any, TOutput = any> {
  /**
   * Renders the tool use message when the tool is invoked
   */
  renderToolUse: (input: TInput, context: ToolRenderContext) => React.ReactNode;
  
  /**
   * Renders the tool result message when the tool completes
   */
  renderToolResult: (output: TOutput, context: ToolRenderContext) => React.ReactNode;
  
  /**
   * Renders the tool rejection message when the tool use is rejected
   */
  renderToolRejected: (input: TInput, context: ToolRenderContext) => React.ReactNode;
}