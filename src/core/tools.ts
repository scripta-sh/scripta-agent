/**
 * Tool management for the API implementation
 * Provides utility functions for accessing tools
 */

import { Tool } from '../Tool'
import { AgentTool } from '../tools/AgentTool/AgentTool'
import { BashTool } from '../tools/BashTool/BashTool'
import { FileEditTool } from '../tools/FileEditTool/FileEditTool'
import { FileReadTool } from '../tools/FileReadTool/FileReadTool'
import { FileWriteTool } from '../tools/FileWriteTool/FileWriteTool'
import { GlobTool } from '../tools/GlobTool/GlobTool'
import { GrepTool } from '../tools/GrepTool/GrepTool'
import { LSTool } from '../tools/lsTool/lsTool'
import { NotebookEditTool } from '../tools/NotebookEditTool/NotebookEditTool'
import { NotebookReadTool } from '../tools/NotebookReadTool/NotebookReadTool'
import { ThinkTool } from '../tools/ThinkTool/ThinkTool'

/**
 * Options for getting available tools
 */
export interface ToolOptions {
  isMCP?: boolean;
  dangerouslySkipPermissions?: boolean;
}

/**
 * Get all available tools
 * This function is used by the API server to list available tools
 */
export function getAvailableTools(options: ToolOptions = {}): Tool[] {
  const { isMCP = false, dangerouslySkipPermissions = false } = options
  
  // Standard tools available to all users
  const standardTools = [
    AgentTool,
    BashTool,
    GlobTool,
    GrepTool,
    LSTool,
    FileReadTool,
    FileEditTool,
    FileWriteTool,
    NotebookReadTool,
    NotebookEditTool,
    ThinkTool,
  ]
  
  return standardTools
}

/**
 * Get read-only tools
 * These tools cannot modify the filesystem or execute code
 */
export function getReadOnlyTools(): Tool[] {
  return getAvailableTools().filter(tool => tool.isReadOnly())
}
