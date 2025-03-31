# Core Tools Architecture

This directory contains the core tool implementation for Scripta Agent. The tools are organized into a structured architecture that allows for easy discovery, management, and extension.

## Directory Structure

- `interfaces/` - Contains the core Tool interface definition
- `base/` - Contains the BaseTool abstract class that all tools extend
- `types/` - Contains shared types used by multiple tools
- `registry.ts` - Central registry for tool discovery and management
- `compatLayer.ts` - Compatibility layer for backward compatibility
- Category directories:
  - `filesystem/` - Tools for filesystem operations (read, write, edit, glob, grep, ls)
  - `shell/` - Tools for shell operations (bash)
  - `notebook/` - Tools for notebook operations (read, edit)
  - `memory/` - Tools for memory operations (read, write)
  - `agent/` - Tools for agent operations (think, agent, architect)
  - `external/` - Tools for external services (MCP)

## Tool Registration

Tools are registered with the central registry using the `registerTool` function. This allows for dynamic discovery and filtering of tools. Tools can be organized into categories, and the registry provides functions for retrieving tools by category or other criteria.

```typescript
import { registerTool, ToolCategories } from '../registry';
import { CoreFileReadTool } from './FileReadTool/FileReadTool';

// Create and register tool instance
export const FileReadTool = new CoreFileReadTool();
registerTool(FileReadTool, [ToolCategories.FILESYSTEM]);
```

## Tool Implementation

Tools are implemented as classes that extend the `BaseTool` abstract class. Each tool must implement the required methods and properties defined by the `Tool` interface:

```typescript
export class CoreFileReadTool extends BaseTool {
  name = 'View';
  inputSchema = inputSchema;
  
  async description() { return DESCRIPTION; }
  async prompt({ dangerouslySkipPermissions }) { return PROMPT; }
  userFacingName() { return 'Read'; }
  isReadOnly(): boolean { return true; }
  // ... other method implementations
}
```

## Compatibility Layer

To ensure backward compatibility with existing code, a compatibility layer is provided. This layer wraps core tools to match the legacy tool interface:

```typescript
import { getLegacyTools } from './core/tools/compatLayer';

// Get all legacy-compatible tools
const legacyTools = await getLegacyTools();
```

## Tool Categories

Tools are organized into the following categories:

- `FILESYSTEM` - Tools for filesystem operations
- `SHELL` - Tools for shell operations
- `NOTEBOOK` - Tools for notebook operations
- `MEMORY` - Tools for memory operations
- `AGENT` - Tools for agent operations
- `EXTERNAL` - Tools for external services

## Integration with ScriptaCore

ScriptaCore integrates with the tool registry via the `getEnabledTools` function:

```typescript
import { getEnabledTools } from './tools/registry';

// Get all enabled tools
const enabledTools = await getEnabledTools();
```

## Migration Status

All tools have been successfully migrated to the new core structure:

- [x] Core tools infrastructure
- [x] FileReadTool
- [x] BashTool
- [x] GlobTool
- [x] GrepTool
- [x] LSTool
- [x] FileWriteTool
- [x] FileEditTool
- [x] NotebookReadTool
- [x] NotebookEditTool
- [x] MemoryReadTool
- [x] MemoryWriteTool
- [x] ThinkTool
- [x] AgentTool
- [x] ArchitectTool
- [x] MCPTool