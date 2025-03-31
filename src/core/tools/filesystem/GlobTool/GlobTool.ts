import { z } from 'zod'
import { isAbsolute, relative, resolve } from 'path'
import { BaseTool } from '../../base/BaseTool'
import { ToolUseContext } from '../../types'
import { DESCRIPTION, TOOL_NAME_FOR_PROMPT } from './prompt'

// Utility imports - will be updated later
import { glob } from '../../../../utils/file'
import { getCwd } from '../../../../utils/state'
import { hasReadPermission } from '../../../../utils/permissions/filesystem'

const inputSchema = z.strictObject({
  pattern: z.string().describe('The glob pattern to match files against'),
  path: z
    .string()
    .optional()
    .describe(
      'The directory to search in. Defaults to the current working directory.',
    ),
})

type GlobToolInput = z.infer<typeof inputSchema>;

type GlobToolOutput = {
  durationMs: number
  numFiles: number
  filenames: string[]
  truncated: boolean
}

export class CoreGlobTool extends BaseTool {
  name = TOOL_NAME_FOR_PROMPT;
  inputSchema = inputSchema;

  async description() {
    return DESCRIPTION;
  }

  userFacingName() {
    return 'Search';
  }

  async isEnabled() {
    return true;
  }

  isReadOnly(): boolean {
    return true;
  }

  needsPermissions({ path }: GlobToolInput) {
    return !hasReadPermission(path || getCwd());
  }

  async prompt() {
    return DESCRIPTION;
  }

  async *call(
    { pattern, path }: GlobToolInput, 
    { abortController }: ToolUseContext
  ) {
    const start = Date.now();
    const { files, truncated } = await glob(
      pattern,
      path ?? getCwd(),
      { limit: 100, offset: 0 },
      abortController.signal,
    );

    const output: GlobToolOutput = {
      filenames: files,
      durationMs: Date.now() - start,
      numFiles: files.length,
      truncated,
    };

    yield {
      type: 'result',
      resultForAssistant: this.renderResultForAssistant(output),
      data: output,
    };
  }

  renderResultForAssistant(output: GlobToolOutput): string {
    let result = output.filenames.join('\n');
    if (output.filenames.length === 0) {
      result = 'No files found';
    }
    // Only add truncation message if results were actually truncated
    else if (output.truncated) {
      result +=
        '\n(Results are truncated. Consider using a more specific path or pattern.)';
    }
    return result;
  }
}