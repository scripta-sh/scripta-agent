import { registerToolRenderer, registerCategoryRenderer } from './getToolRenderer';
import { BashToolRenderer } from './renderers/BashToolRenderer';
import { ToolCategories } from '../../../core/tools/registry';
import { DefaultToolRenderer } from './renderers/DefaultToolRenderer';

/**
 * Initialize all tool renderers
 * This should be called early in the application startup process
 */
export function initializeToolRenderers(): void {
  // Register tool-specific renderers
  registerToolRenderer('Bash', BashToolRenderer);
  
  // Add more tool renderers here as they're implemented
  // registerToolRenderer('Edit', FileEditToolRenderer);
  // registerToolRenderer('View', FileReadToolRenderer);
  
  // Register category renderers for tools that share rendering logic
  // These will be used as fallbacks if no tool-specific renderer exists
  
  // For now, register the default renderer for all categories that don't have specific renderers
  Object.values(ToolCategories).forEach(category => {
    registerCategoryRenderer(category, DefaultToolRenderer);
  });
}