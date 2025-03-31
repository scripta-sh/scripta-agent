/**
 * Legacy tools module
 * This file now uses the new core tools system via the compatibility layer
 */

import { Tool } from './Tool'
import { memoize } from 'lodash-es'
import { getLegacyTools } from './core/tools/compatLayer'
import { MCPToolLegacy } from './core/tools/compatLayer'
import { ArchitectToolLegacy } from './core/tools/compatLayer'
import { AgentToolLegacy } from './core/tools/compatLayer'
import { BashToolLegacy } from './core/tools/compatLayer'
import { GlobToolLegacy } from './core/tools/compatLayer'
import { GrepToolLegacy } from './core/tools/compatLayer'
import { LSToolLegacy } from './core/tools/compatLayer'
import { FileReadToolLegacy } from './core/tools/compatLayer'
import { FileEditToolLegacy } from './core/tools/compatLayer'
import { FileWriteToolLegacy } from './core/tools/compatLayer'
import { NotebookReadToolLegacy } from './core/tools/compatLayer'
import { NotebookEditToolLegacy } from './core/tools/compatLayer'
import { ThinkToolLegacy } from './core/tools/compatLayer'
import { MemoryReadToolLegacy } from './core/tools/compatLayer'
import { MemoryWriteToolLegacy } from './core/tools/compatLayer'
import { getMCPTools } from './services/mcpClient'

const ANT_ONLY_TOOLS = [MemoryReadToolLegacy, MemoryWriteToolLegacy]

/**
 * Get all tools (legacy implementation)
 * This function is now a compatibility wrapper
 */
export const getAllTools = (): Tool[] => {
  return [
    AgentToolLegacy,
    BashToolLegacy,
    GlobToolLegacy,
    GrepToolLegacy,
    LSToolLegacy,
    FileReadToolLegacy,
    FileEditToolLegacy,
    FileWriteToolLegacy,
    NotebookReadToolLegacy,
    NotebookEditToolLegacy,
    ThinkToolLegacy,
    ...ANT_ONLY_TOOLS,
  ]
}

/**
 * Get enabled tools (legacy implementation)
 * This function now uses the new core tools system via getLegacyTools
 */
export const getTools = memoize(
  async (enableArchitect?: boolean): Promise<Tool[]> => {
    // Use the compatibility layer to get all enabled tools
    const legacyTools = await getLegacyTools()
    
    // Add MCP tools from the original service
    const mcpTools = await getMCPTools()
    
    const allTools = [...legacyTools, ...mcpTools]

    // Only include Architect tool if enabled via config or CLI flag
    if (enableArchitect && !allTools.some(tool => tool.name === ArchitectToolLegacy.name)) {
      allTools.push(ArchitectToolLegacy)
    }

    return allTools;
  },
)

/**
 * Get read-only tools (legacy implementation)
 * This function is now a compatibility wrapper
 */
export const getReadOnlyTools = memoize(async (): Promise<Tool[]> => {
  // Get all tools from the compatibility layer
  const legacyTools = await getLegacyTools()
  
  // Filter to only include read-only tools
  return legacyTools.filter(tool => tool.isReadOnly())
})