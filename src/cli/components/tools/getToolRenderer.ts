import { ToolRenderer } from './ToolRenderer';
import { DefaultToolRenderer } from './renderers/DefaultToolRenderer';
import { getToolCategory } from '../../../core/tools';
import { ToolCategories } from '../../../core/tools/registry';

// Registry of tool renderers by name
const rendererRegistry: Record<string, ToolRenderer> = {};

// Registry of tool renderers by category
const categoryRendererRegistry: Record<string, ToolRenderer> = {};

/**
 * Register a tool renderer for a specific tool
 */
export function registerToolRenderer(toolName: string, renderer: ToolRenderer): void {
  rendererRegistry[toolName] = renderer;
}

/**
 * Register a tool renderer for all tools in a category
 */
export function registerCategoryRenderer(category: string, renderer: ToolRenderer): void {
  categoryRendererRegistry[category] = renderer;
}

/**
 * Get the renderer for a specific tool
 * Falls back to category renderer, then default renderer
 */
export function getToolRenderer(toolName: string): ToolRenderer {
  // First try to get a renderer specific to this tool
  if (rendererRegistry[toolName]) {
    return rendererRegistry[toolName];
  }
  
  // Then try to get a renderer for the tool's category
  const category = getToolCategory(toolName);
  if (category && categoryRendererRegistry[category]) {
    return categoryRendererRegistry[category];
  }
  
  // Fall back to default renderer
  return DefaultToolRenderer;
}