/**
 * Core agent tools
 */

import { CoreThinkTool } from './ThinkTool/ThinkTool';
import { CoreAgentTool } from './AgentTool/AgentTool';
import { CoreArchitectTool } from './ArchitectTool/ArchitectTool';
import { registerTool, ToolCategories } from '../registry';

// Create and register tool instances
export const ThinkTool = new CoreThinkTool();
export const AgentTool = new CoreAgentTool();
export const ArchitectTool = new CoreArchitectTool();

// Register tools with categories
registerTool(ThinkTool, [ToolCategories.AGENT]);
registerTool(AgentTool, [ToolCategories.AGENT]);
registerTool(ArchitectTool, [ToolCategories.AGENT]);

