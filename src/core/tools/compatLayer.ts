/**
 * Compatibility layer for tools
 * This provides backward compatibility with the old tool interface
 */

import { Tool as CoreTool } from './interfaces/Tool';
import { getAllTools, getEnabledTools } from './registry';
import { Tool as LegacyTool } from './types';

/**
 * Create a legacy wrapper for a core tool
 * This adapts the new core tool interface to the old legacy interface
 */
function createLegacyWrapper<T extends CoreTool>(coreTool: T): LegacyTool {
  return {
    name: coreTool.name,
    description: coreTool.description,
    inputSchema: coreTool.inputSchema,
    inputJSONSchema: coreTool.inputJSONSchema,
    prompt: coreTool.prompt,
    userFacingName: coreTool.userFacingName,
    isEnabled: coreTool.isEnabled,
    isReadOnly: coreTool.isReadOnly,
    needsPermissions: coreTool.needsPermissions,
    validateInput: coreTool.validateInput,
    call: coreTool.call,
    renderResultForAssistant: coreTool.renderResultForAssistant,
  };
}

/**
 * Get all tools in a legacy format
 * This is a replacement for the getTools function in src/tools.ts
 */
export async function getLegacyTools(): Promise<LegacyTool[]> {
  // Get enabled tools from the registry and convert them to legacy format
  const enabledTools = await getEnabledTools();
  return enabledTools.map(createLegacyWrapper);
}

// Export individual legacy tools
// Import from each category without using named imports to avoid conflicts
import * as filesystemTools from './filesystem';
import * as shellTools from './shell';
import * as notebookTools from './notebook';
import * as memoryTools from './memory';
import * as agentTools from './agent';
import * as externalTools from './external';

// Get references to each tool
const FileReadTool = filesystemTools.FileReadTool;
const FileWriteTool = filesystemTools.FileWriteTool;
const FileEditTool = filesystemTools.FileEditTool;
const GlobTool = filesystemTools.GlobTool;
const GrepTool = filesystemTools.GrepTool;
const LSTool = filesystemTools.LSTool;
const BashTool = shellTools.BashTool;
const NotebookReadTool = notebookTools.NotebookReadTool;
const NotebookEditTool = notebookTools.NotebookEditTool;
const MemoryReadTool = memoryTools.MemoryReadTool;
const MemoryWriteTool = memoryTools.MemoryWriteTool;
const ThinkTool = agentTools.ThinkTool;
const AgentTool = agentTools.AgentTool;
const ArchitectTool = agentTools.ArchitectTool;
const MCPTool = externalTools.MCPTool;

// Export legacy-wrapped tools
export const FileReadToolLegacy = createLegacyWrapper(FileReadTool);
export const FileWriteToolLegacy = createLegacyWrapper(FileWriteTool);
export const FileEditToolLegacy = createLegacyWrapper(FileEditTool);
export const GlobToolLegacy = createLegacyWrapper(GlobTool);
export const GrepToolLegacy = createLegacyWrapper(GrepTool);
export const LSToolLegacy = createLegacyWrapper(LSTool);
export const BashToolLegacy = createLegacyWrapper(BashTool);
export const NotebookReadToolLegacy = createLegacyWrapper(NotebookReadTool);
export const NotebookEditToolLegacy = createLegacyWrapper(NotebookEditTool);
export const MemoryReadToolLegacy = createLegacyWrapper(MemoryReadTool);
export const MemoryWriteToolLegacy = createLegacyWrapper(MemoryWriteTool);
export const ThinkToolLegacy = createLegacyWrapper(ThinkTool);
export const AgentToolLegacy = createLegacyWrapper(AgentTool);
export const ArchitectToolLegacy = createLegacyWrapper(ArchitectTool);
export const MCPToolLegacy = createLegacyWrapper(MCPTool);