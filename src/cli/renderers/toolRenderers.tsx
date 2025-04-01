import * as React from 'react';
import { Box, Text } from 'ink';
import { EOL } from 'os';
import { extname, relative } from 'path';
import { FallbackToolUseRejectedMessage } from '../components/FallbackToolUseRejectedMessage';
import { HighlightedCode } from '../components/HighlightedCode';
import { FileEditToolUpdatedMessage } from '../components/FileEditToolUpdatedMessage';
import { StructuredDiff } from '../components/StructuredDiff';
import { Cost } from '../components/Cost';
import { getTheme } from '../../utils/theme';
import { getCwd } from '../../utils/state';
import { intersperse } from '../../utils/array';
import { applyMarkdown } from '../../utils/markdown';
import { Hunk } from 'diff';
import { Tool } from '../../core/tools/interfaces/Tool';
import { ToolCategories } from '../../core/tools/registry';
import { getToolCategory, getToolDisplayName } from '../../core/tools';
import { applyEdit } from '../../core/tools/filesystem/FileEditTool/utils';
import { getPatch } from '../../utils/diff';
import { existsSync, readFileSync } from 'fs';
import { detectFileEncoding } from '../../utils/file';
import { 
  renderToolUseMessage as newRenderToolUseMessage,
  renderToolResultMessage as newRenderToolResultMessage,
  renderToolUseRejectedMessage as newRenderToolUseRejectedMessage,
  OutputLine 
} from '../components/tools';

// TODO: Define proper types for the 'data' parameter for each tool's output
// TODO: Define proper types for the 'input' parameter for each tool's input

const MAX_LINES_TO_RENDER = 3; // From FileReadTool

// --- Rendering Tool Use Messages ---

// Note: We now import getToolCategory from core/tools instead of defining it here

/**
 * Renders the tool use message based on the tool name and input
 * Uses core tool metadata for better categorization
 */
export function renderToolUseMessage(toolName: string, input: any, verbose: boolean): React.ReactNode {
  // Delegate to the new implementation
  return newRenderToolUseMessage(toolName, input, verbose);
}

// --- Rendering Tool Result Messages ---

// Import the ToolResultContainer from the new location
import { ToolResultContainer } from '../components/tools';

/**
 * Renders the tool result message based on the tool name and data
 * Uses core tool metadata for better categorization
 */
export function renderToolResultMessage(toolName: string, data: any, verbose: boolean): React.ReactNode {
  // Delegate to the new implementation
  return newRenderToolResultMessage(toolName, data, verbose);
}


// --- Rendering Tool Rejection Messages ---

/**
 * Renders a message when a tool use is rejected
 * Uses core tool metadata for better categorization
 */
export function renderToolUseRejectedMessage(toolName: string, input: any, context: { columns: number, verbose: boolean }): React.ReactNode {
  // Delegate to the new implementation
  return newRenderToolUseRejectedMessage(toolName, input, context);
} 