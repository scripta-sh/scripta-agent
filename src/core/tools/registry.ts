/**
 * Tool Registry for managing tool registration and discovery
 */

import { memoize } from 'lodash-es';
import { Tool } from './interfaces/Tool';

// Storage for registered tools
const registeredTools = new Map<string, Tool>();

// Storage for tool categories
const toolCategories = new Map<string, Set<string>>();

/**
 * Register a tool with the registry
 * @param tool The tool to register
 * @param categories Optional categories to associate with the tool
 */
export function registerTool(tool: Tool, categories: string[] = []): void {
  if (registeredTools.has(tool.name)) {
    throw new Error(`Tool with name "${tool.name}" is already registered`);
  }
  
  registeredTools.set(tool.name, tool);
  
  // Register the tool with provided categories
  for (const category of categories) {
    if (!toolCategories.has(category)) {
      toolCategories.set(category, new Set());
    }
    toolCategories.get(category)?.add(tool.name);
  }
}

/**
 * Get a registered tool by name
 * @param name The name of the tool
 * @returns The tool or undefined if not found
 */
export function getTool(name: string): Tool | undefined {
  return registeredTools.get(name);
}

/**
 * Get a tool by name or throw if not found
 * @param name The name of the tool
 * @returns The tool
 * @throws Error if the tool is not found
 */
export function getToolOrThrow(name: string): Tool {
  const tool = getTool(name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
}

/**
 * Get all registered tools
 * @returns Array of all registered tools
 */
export function getAllTools(): Tool[] {
  return Array.from(registeredTools.values());
}

/**
 * Get all tools in a specific category
 * @param category The category to filter by
 * @returns Array of tools in the category
 */
export function getToolsByCategory(category: string): Tool[] {
  const toolNames = toolCategories.get(category) || new Set();
  return Array.from(toolNames)
    .map(name => registeredTools.get(name))
    .filter((tool): tool is Tool => tool !== undefined);
}

/**
 * Get tools that match a filter function
 * @param filterFn Function to filter tools
 * @returns Array of matching tools
 */
export function getToolsByFilter(filterFn: (tool: Tool) => boolean): Tool[] {
  return getAllTools().filter(filterFn);
}

/**
 * Get all enabled tools (memoized for performance)
 */
export const getEnabledTools = memoize(
  async (): Promise<Tool[]> => {
    const tools = getAllTools();
    const isEnabled = await Promise.all(tools.map(tool => tool.isEnabled()));
    return tools.filter((_, i) => isEnabled[i]);
  }
);

/**
 * Get all read-only tools (memoized for performance)
 */
export const getReadOnlyTools = memoize(
  async (): Promise<Tool[]> => {
    const tools = getAllTools().filter(tool => tool.isReadOnly());
    const isEnabled = await Promise.all(tools.map(tool => tool.isEnabled()));
    return tools.filter((_, i) => isEnabled[i]);
  }
);

/**
 * Clear all registered tools (mainly for testing)
 */
export function clearRegistry(): void {
  registeredTools.clear();
  toolCategories.clear();
}

/**
 * Categories for standard tools
 */
export const ToolCategories = {
  FILESYSTEM: 'filesystem',
  SHELL: 'shell',
  NOTEBOOK: 'notebook',
  AGENT: 'agent',
  MEMORY: 'memory',
  EXTERNAL: 'external',
} as const;