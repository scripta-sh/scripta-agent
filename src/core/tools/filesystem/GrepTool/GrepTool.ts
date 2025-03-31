import { stat } from 'fs/promises'
import { z } from 'zod'
import { BaseTool } from '../../base/BaseTool'
import { ToolUseContext } from '../../types'
import { DESCRIPTION, TOOL_NAME_FOR_PROMPT } from './prompt'

// Utility imports - will be updated later
import { getAbsolutePath } from '../../../../utils/file.js'
import { ripGrep } from '../../../../utils/ripgrep'
import { getCwd } from '../../../../utils/state'
import { hasReadPermission } from '../../../../utils/permissions/filesystem'

const inputSchema = z.strictObject({
  pattern: z
    .string()
    .describe('The regular expression pattern to search for in file contents'),
  path: z
    .string()
    .optional()
    .describe(
      'The directory to search in. Defaults to the current working directory.',
    ),
  include: z
    .string()
    .optional()
    .describe(
      'File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")',
    ),
})

const MAX_RESULTS = 100

type GrepToolInput = z.infer<typeof inputSchema>;

type GrepToolOutput = {
  durationMs: number
  numFiles: number
  filenames: string[]
}

export class CoreGrepTool extends BaseTool {
  name = TOOL_NAME_FOR_PROMPT;
  inputSchema = inputSchema;

  async description() {
    return DESCRIPTION;
  }

  userFacingName() {
    return 'Search';
  }

  isReadOnly(): boolean {
    return true;
  }

  async isEnabled() {
    return true;
  }

  needsPermissions({ path }: GrepToolInput) {
    return !hasReadPermission(path || getCwd());
  }

  async prompt() {
    return DESCRIPTION;
  }

  renderResultForAssistant({ numFiles, filenames }: GrepToolOutput): string {
    if (numFiles === 0) {
      return 'No files found';
    }
    let result = `Found ${numFiles} file${numFiles === 1 ? '' : 's'}\n${filenames.slice(0, MAX_RESULTS).join('\n')}`;
    if (numFiles > MAX_RESULTS) {
      result +=
        '\n(Results are truncated. Consider using a more specific path or pattern.)';
    }
    return result;
  }

  async *call(
    { pattern, path, include }: GrepToolInput, 
    { abortController }: ToolUseContext
  ) {
    const start = Date.now();
    const absolutePath = getAbsolutePath(path) || getCwd();

    const args = ['-li', pattern];
    if (include) {
      args.push('--glob', include);
    }

    const results = await ripGrep(args, absolutePath, abortController.signal);

    const stats = await Promise.all(results.map(_ => stat(_)));
    const matches = results
      // Sort by modification time
      .map((_, i) => [_, stats[i]!] as const)
      .sort((a, b) => {
        if (process.env.NODE_ENV === 'test') {
          // In tests, we always want to sort by filename, so that results are deterministic
          return a[0].localeCompare(b[0]);
        }
        const timeComparison = (b[1].mtimeMs ?? 0) - (a[1].mtimeMs ?? 0);
        if (timeComparison === 0) {
          // Sort by filename as a tiebreaker
          return a[0].localeCompare(b[0]);
        }
        return timeComparison;
      })
      .map(_ => _[0]);

    const output: GrepToolOutput = {
      filenames: matches,
      durationMs: Date.now() - start,
      numFiles: matches.length,
    };

    yield {
      type: 'result',
      resultForAssistant: this.renderResultForAssistant(output),
      data: output,
    };
  }
}