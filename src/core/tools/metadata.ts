/**
 * Tool metadata utilities
 * These functions help application layers render tools appropriately
 * without coupling the core to specific UI implementations
 */

import { Tool } from './interfaces/Tool';
import { ToolCategories } from './registry';

/**
 * Tool metadata for UI rendering
 */
export interface ToolMetadata {
  name: string;
  category: string;
  displayName: string;
  isReadOnly: boolean;
  description: string;
  renderPriority?: number; // Higher numbers render first
}

/**
 * Get tool category based on tool name
 * Used primarily by rendering components
 */
export function getToolCategory(toolName: string): string {
  if (toolName === 'View' || toolName === 'Edit' || toolName === 'Replace' || 
      toolName === 'Glob' || toolName === 'Grep' || toolName === 'LS') {
    return ToolCategories.FILESYSTEM;
  } else if (toolName === 'Bash') {
    return ToolCategories.SHELL;
  } else if (toolName === 'ReadNotebook' || toolName === 'NotebookEditCell') {
    return ToolCategories.NOTEBOOK;
  } else if (toolName === 'MemoryRead' || toolName === 'MemoryWrite') {
    return ToolCategories.MEMORY;
  } else if (toolName === 'Task' || toolName === 'Think' || toolName === 'Architect') {
    return ToolCategories.AGENT;
  } else if (toolName === 'mcp') {
    return ToolCategories.EXTERNAL;
  } else {
    return 'other';
  }
}

/**
 * Get a friendly display name for a tool
 */
export function getToolDisplayName(toolName: string): string {
  switch (toolName) {
    case 'View': return 'File Read';
    case 'Edit': return 'File Edit';
    case 'Replace': return 'File Write';
    case 'Glob': return 'File Search';
    case 'Grep': return 'Content Search';
    case 'LS': return 'Directory List';
    case 'Bash': return 'Shell Command';
    case 'ReadNotebook': return 'Notebook Read';
    case 'NotebookEditCell': return 'Notebook Edit';
    case 'MemoryRead': return 'Memory Read';
    case 'MemoryWrite': return 'Memory Write';
    case 'Task': return 'Agent Task';
    case 'Think': return 'Thinking';
    case 'Architect': return 'Architecture Analysis';
    case 'mcp': return 'External Service';
    default: return toolName;
  }
}

/**
 * Get full metadata for a tool 
 * Can be used by UI components without tight coupling
 */
export async function getToolMetadata(tool: Tool): Promise<ToolMetadata> {
  // Get the description - handle both string and function types
  const description = typeof tool.description === 'function' 
    ? await tool.description({}) 
    : tool.description;
  
  return {
    name: tool.name,
    category: getToolCategory(tool.name),
    displayName: getToolDisplayName(tool.name),
    isReadOnly: tool.isReadOnly?.() ?? false,
    description,
    renderPriority: getRenderPriority(tool.name),
  };
}

/**
 * Get rendering priority for tools
 * Higher numbers render first
 */
function getRenderPriority(toolName: string): number {
  switch (toolName) {
    case 'Think': return 100; // Think should render first
    case 'Bash': return 90;
    case 'Task': return 80;
    case 'Edit': case 'Replace': return 70;
    case 'View': return 60;
    case 'Glob': case 'Grep': case 'LS': return 50;
    case 'ReadNotebook': case 'NotebookEditCell': return 40;
    case 'Architect': return 30;
    case 'MemoryRead': case 'MemoryWrite': return 20;
    case 'mcp': return 10;
    default: return 0;
  }
}