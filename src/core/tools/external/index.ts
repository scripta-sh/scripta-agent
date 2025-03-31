/**
 * Core external tools
 */

import { CoreMCPTool } from './MCPTool/MCPTool';
import { registerTool, ToolCategories } from '../registry';

// Create and register tool instances
export const MCPTool = new CoreMCPTool();

// Register tools with categories
registerTool(MCPTool, [ToolCategories.EXTERNAL]);

