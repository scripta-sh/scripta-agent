/**
 * Core notebook tools
 */

import { CoreNotebookReadTool } from './NotebookReadTool/NotebookReadTool';
import { CoreNotebookEditTool } from './NotebookEditTool/NotebookEditTool';
import { registerTool, ToolCategories } from '../registry';

// Create and register tool instances
export const NotebookReadTool = new CoreNotebookReadTool();
export const NotebookEditTool = new CoreNotebookEditTool();

// Register tools with categories
registerTool(NotebookReadTool, [ToolCategories.NOTEBOOK]);
registerTool(NotebookEditTool, [ToolCategories.NOTEBOOK]);

