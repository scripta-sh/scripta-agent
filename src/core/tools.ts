/**
 * Core tools exports
 * This is the main entry point for tools in the core module
 */

// Export tool interface and types
export type { Tool } from './tools/interfaces/Tool';
export { BaseTool } from './tools/base/BaseTool';
export * from './tools/types';

// Export registry functions
export {
  registerTool,
  getTool,
  getToolOrThrow,
  getAllTools,
  getToolsByCategory,
  getToolsByFilter,
  getEnabledTools,
  getReadOnlyTools,
  ToolCategories,
} from './tools/registry';

// Export tools by category
export * from './tools/filesystem';
export * from './tools/shell';
export * from './tools/notebook';
export * from './tools/memory';
export * from './tools/agent';
export * from './tools/external';

// Export compatibility layer for legacy code
export { getLegacyTools } from './tools/compatLayer';

// Export metadata utilities for UI rendering
export {
  getToolCategory,
  getToolDisplayName,
  getToolMetadata,
  type ToolMetadata
} from './tools/metadata';