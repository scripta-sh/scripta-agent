import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { z } from 'zod'
import { BaseTool } from '../../base/BaseTool'
import { ToolUseContext } from '../../types'
import { DESCRIPTION, PROMPT } from './prompt'

// Utility imports - will be updated later
import { MEMORY_DIR } from '../../../../utils/env'

const inputSchema = z.strictObject({
  file_path: z.string().describe('Path to the memory file to write'),
  content: z.string().describe('Content to write to the file'),
})

type MemoryWriteToolInput = z.infer<typeof inputSchema>;

export class CoreMemoryWriteTool extends BaseTool {
  name = 'MemoryWrite';
  inputSchema = inputSchema;

  async description() {
    return DESCRIPTION;
  }

  async prompt() {
    return PROMPT;
  }

  userFacingName() {
    return 'Write Memory';
  }

  async isEnabled() {
    // Enabled for use
    return true;
  }

  isReadOnly(): boolean {
    return false;
  }

  needsPermissions(): boolean {
    return false;
  }

  renderResultForAssistant(content: string): string {
    return content;
  }

  async validateInput({ file_path }: MemoryWriteToolInput) {
    const fullPath = join(MEMORY_DIR, file_path);
    if (!fullPath.startsWith(MEMORY_DIR)) {
      return { result: false, message: 'Invalid memory file path' };
    }
    return { result: true };
  }

  async *call({ file_path, content }: MemoryWriteToolInput) {
    const fullPath = join(MEMORY_DIR, file_path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
    yield {
      type: 'result',
      data: 'Saved',
      resultForAssistant: 'Saved',
    };
  }
}