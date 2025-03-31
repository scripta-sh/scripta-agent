/**
 * Core shell tools
 */

import { CoreBashTool } from './BashTool/BashTool';
import { registerTool, ToolCategories } from '../registry';

// Create and register tool instances
export const BashTool = new CoreBashTool();

// Register tools with categories
registerTool(BashTool, [ToolCategories.SHELL]);

