/**
 * Core filesystem tools
 */

import { CoreFileReadTool } from './FileReadTool/FileReadTool';
import { CoreFileWriteTool } from './FileWriteTool/FileWriteTool';
import { CoreFileEditTool } from './FileEditTool/FileEditTool';
import { CoreGlobTool } from './GlobTool/GlobTool';
import { CoreGrepTool } from './GrepTool/GrepTool';
import { CoreLSTool } from './LSTool/LSTool';
import { registerTool, ToolCategories } from '../registry';

// Create and register tool instances
export const FileReadTool = new CoreFileReadTool();
export const FileWriteTool = new CoreFileWriteTool();
export const FileEditTool = new CoreFileEditTool();
export const GlobTool = new CoreGlobTool();
export const GrepTool = new CoreGrepTool();
export const LSTool = new CoreLSTool();

// Register tools with categories
registerTool(FileReadTool, [ToolCategories.FILESYSTEM]);
registerTool(FileWriteTool, [ToolCategories.FILESYSTEM]);
registerTool(FileEditTool, [ToolCategories.FILESYSTEM]);
registerTool(GlobTool, [ToolCategories.FILESYSTEM]);
registerTool(GrepTool, [ToolCategories.FILESYSTEM]);
registerTool(LSTool, [ToolCategories.FILESYSTEM]);