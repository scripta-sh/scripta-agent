/**
 * Core memory tools
 */

import { CoreMemoryReadTool } from './MemoryReadTool/MemoryReadTool';
import { CoreMemoryWriteTool } from './MemoryWriteTool/MemoryWriteTool';
import { registerTool, ToolCategories } from '../registry';

// Create and register tool instances
export const MemoryReadTool = new CoreMemoryReadTool();
export const MemoryWriteTool = new CoreMemoryWriteTool();

// Register tools with categories
registerTool(MemoryReadTool, [ToolCategories.MEMORY]);
registerTool(MemoryWriteTool, [ToolCategories.MEMORY]);

