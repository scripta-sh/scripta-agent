import { z } from 'zod'
import { BaseTool } from '../../base/BaseTool'
import { DESCRIPTION, PROMPT } from './prompt'

// Allow any input object since MCP tools define their own schemas
const inputSchema = z.object({}).passthrough()

export class CoreMCPTool extends BaseTool {
  // Overridden in mcpClient.ts
  name = 'mcp';
  inputSchema = inputSchema;

  // Overridden in mcpClient.ts
  async description() {
    return DESCRIPTION;
  }

  // Overridden in mcpClient.ts
  async prompt() {
    return PROMPT;
  }

  isReadOnly(): boolean {
    return false;
  }

  async isEnabled() {
    return true;
  }

  needsPermissions(): boolean {
    return true;
  }

  // Overridden in mcpClient.ts
  userFacingName() {
    return 'mcp';
  }

  // Overridden in mcpClient.ts
  async *call() {
    yield {
      type: 'result',
      data: '',
      resultForAssistant: '',
    };
  }

  renderResultForAssistant(content: string): string {
    return content;
  }
}