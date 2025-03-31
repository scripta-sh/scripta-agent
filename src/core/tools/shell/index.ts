/**
 * Core shell tools
 */

import { CoreBashTool } from './BashTool/BashTool';
import { registerTool, ToolCategories } from '../registry';
import { z } from 'zod';

// Export Bash input schema for use in other modules
export const inputSchema = z.strictObject({
  command: z.string().describe('The command to execute'),
  timeout: z
    .number()
    .optional()
    .describe('Optional timeout in milliseconds (max 600000)'),
});

// Create and register tool instances
export const BashTool = new CoreBashTool();

// Register tools with categories
registerTool(BashTool, [ToolCategories.SHELL]);

