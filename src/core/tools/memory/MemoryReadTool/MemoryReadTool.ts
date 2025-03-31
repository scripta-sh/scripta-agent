import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { BaseTool } from '../../base/BaseTool'
import { ToolUseContext } from '../../types'
import { DESCRIPTION, PROMPT } from './prompt'

// Utility imports - will be updated later
import { MEMORY_DIR } from '../../../../utils/env'

const inputSchema = z.strictObject({
  file_path: z
    .string()
    .optional()
    .describe('Optional path to a specific memory file to read'),
})

type MemoryReadToolInput = z.infer<typeof inputSchema>;
type MemoryReadToolOutput = { content: string };

export class CoreMemoryReadTool extends BaseTool {
  name = 'MemoryRead';
  inputSchema = inputSchema;

  async description() {
    return DESCRIPTION;
  }

  async prompt() {
    return PROMPT;
  }

  userFacingName() {
    return 'Read Memory';
  }

  async isEnabled() {
    // Enabled for use
    return true;
  }

  isReadOnly(): boolean {
    return true;
  }

  needsPermissions(): boolean {
    return false;
  }

  renderResultForAssistant({ content }: MemoryReadToolOutput): string {
    return content;
  }

  async validateInput({ file_path }: MemoryReadToolInput) {
    if (file_path) {
      const fullPath = join(MEMORY_DIR, file_path);
      if (!fullPath.startsWith(MEMORY_DIR)) {
        return { result: false, message: 'Invalid memory file path' };
      }
      if (!existsSync(fullPath)) {
        return { result: false, message: 'Memory file does not exist' };
      }
    }
    return { result: true };
  }

  async *call({ file_path }: MemoryReadToolInput) {
    mkdirSync(MEMORY_DIR, { recursive: true });

    // If a specific file is requested, return its contents
    if (file_path) {
      const fullPath = join(MEMORY_DIR, file_path);
      if (!existsSync(fullPath)) {
        throw new Error('Memory file does not exist');
      }
      const content = readFileSync(fullPath, 'utf-8');
      yield {
        type: 'result',
        data: { content },
        resultForAssistant: this.renderResultForAssistant({ content }),
      };
      return;
    }

    // Otherwise return the index and file list
    const files = readdirSync(MEMORY_DIR, { recursive: true })
      .map(f => join(MEMORY_DIR, f.toString()))
      .filter(f => !lstatSync(f).isDirectory())
      .map(f => `- ${f}`)
      .join('\n');

    const indexPath = join(MEMORY_DIR, 'index.md');
    const index = existsSync(indexPath) ? readFileSync(indexPath, 'utf-8') : '';

    const quotes = "'''";
    const content = `Here are the contents of the root memory file, \`${indexPath}\`:
${quotes}
${index}
${quotes}

Files in the memory directory:
${files}`;
    yield {
      type: 'result',
      data: { content },
      resultForAssistant: this.renderResultForAssistant({ content }),
    };
  }
}