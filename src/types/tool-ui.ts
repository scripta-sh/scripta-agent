import * as React from 'react';

/**
 * Interface for the ToolJSX state object
 */
export interface ToolJSX {
  jsx: React.ReactNode | null;
  shouldHidePromptInput: boolean;
}

/**
 * Function type for setting the toolJSX state
 */
export type SetToolJSXFn = (toolJSX: ToolJSX | null) => void;

/**
 * Context object for tool rendering
 */
export interface ToolRenderContext {
  verbose: boolean;
  columns: number;
}