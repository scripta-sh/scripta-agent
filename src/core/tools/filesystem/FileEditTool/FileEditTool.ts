import { Hunk } from 'diff'
import { existsSync, mkdirSync, readFileSync, statSync } from 'fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'path'
import { z } from 'zod'
import { BaseTool } from '../../base/BaseTool'
import { ToolUseContext } from '../../types'
import { DESCRIPTION } from './prompt'
import { applyEdit } from './utils'
import { PROJECT_FILE } from '../../../../core/constants/product'

// Utility imports - will be updated later
import {
  addLineNumbers,
  detectFileEncoding,
  detectLineEndings,
  findSimilarFile,
  writeTextContent,
} from '../../../../utils/file.js'
import { logError } from '../../../../utils/log'
import { getCwd } from '../../../../utils/state'
import { hasWritePermission } from '../../../../utils/permissions/filesystem'
import { logEvent } from '../../../../services/statsig'

const inputSchema = z.strictObject({
  file_path: z.string().describe('The absolute path to the file to modify'),
  old_string: z.string().describe('The text to replace'),
  new_string: z.string().describe('The text to replace it with'),
})

type FileEditToolInput = z.infer<typeof inputSchema>;

type FileEditToolOutput = {
  filePath: string
  oldString: string
  newString: string
  originalFile: string
  structuredPatch: Hunk[]
}

// Number of lines of context to include before/after the change in our result message
const N_LINES_SNIPPET = 4

export class CoreFileEditTool extends BaseTool {
  name = 'Edit';
  inputSchema = inputSchema;

  async description() {
    return 'A tool for editing files';
  }

  userFacingName({ old_string, new_string }: FileEditToolInput) {
    if (old_string === '') return 'Create';
    if (new_string === '') return 'Delete';
    return 'Update';
  }

  async prompt() {
    return DESCRIPTION;
  }

  async isEnabled() {
    return true;
  }

  isReadOnly(): boolean {
    return false;
  }

  needsPermissions({ file_path }: FileEditToolInput) {
    return !hasWritePermission(file_path);
  }

  async validateInput(
    { file_path, old_string, new_string }: FileEditToolInput,
    { readFileTimestamps }: ToolUseContext
  ) {
    if (old_string === new_string) {
      return {
        result: false,
        message:
          'No changes to make: old_string and new_string are exactly the same.',
        meta: {
          old_string,
        },
      };
    }

    const fullFilePath = isAbsolute(file_path)
      ? file_path
      : resolve(getCwd(), file_path);

    if (existsSync(fullFilePath) && old_string === '') {
      return {
        result: false,
        message: 'Cannot create new file - file already exists.',
      };
    }

    if (!existsSync(fullFilePath) && old_string === '') {
      return {
        result: true,
      };
    }

    if (!existsSync(fullFilePath)) {
      // Try to find a similar file with a different extension
      const similarFilename = findSimilarFile(fullFilePath);
      let message = 'File does not exist.';

      // If we found a similar file, suggest it to the assistant
      if (similarFilename) {
        message += ` Did you mean ${similarFilename}?`;
      }

      return {
        result: false,
        message,
      };
    }

    if (fullFilePath.endsWith('.ipynb')) {
      return {
        result: false,
        message: `File is a Jupyter Notebook. Use the NotebookEditCell to edit this file.`,
      };
    }

    const readTimestamp = readFileTimestamps[fullFilePath];
    if (!readTimestamp) {
      return {
        result: false,
        message:
          'File has not been read yet. Read it first before writing to it.',
        meta: {
          isFilePathAbsolute: String(isAbsolute(file_path)),
        },
      };
    }

    // Check if file exists and get its last modified time
    const stats = statSync(fullFilePath);
    const lastWriteTime = stats.mtimeMs;
    if (lastWriteTime > readTimestamp) {
      return {
        result: false,
        message:
          'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.',
      };
    }

    const enc = detectFileEncoding(fullFilePath);
    const file = readFileSync(fullFilePath, enc);
    if (!file.includes(old_string)) {
      return {
        result: false,
        message: `String to replace not found in file.`,
        meta: {
          isFilePathAbsolute: String(isAbsolute(file_path)),
        },
      };
    }

    const matches = file.split(old_string).length - 1;
    if (matches > 1) {
      return {
        result: false,
        message: `Found ${matches} matches of the string to replace. For safety, this tool only supports replacing exactly one occurrence at a time. Add more lines of context to your edit and try again.`,
        meta: {
          isFilePathAbsolute: String(isAbsolute(file_path)),
        },
      };
    }

    return { result: true };
  }

  async *call(
    { file_path, old_string, new_string }: FileEditToolInput,
    { readFileTimestamps, abortSignal }: ToolUseContext
  ) {
    const { patch, updatedFile } = applyEdit(file_path, old_string, new_string);

    const fullFilePath = isAbsolute(file_path)
      ? file_path
      : resolve(getCwd(), file_path);
    const dir = dirname(fullFilePath);
    mkdirSync(dir, { recursive: true });
    const enc = existsSync(fullFilePath)
      ? detectFileEncoding(fullFilePath)
      : 'utf8';
    const endings = existsSync(fullFilePath)
      ? detectLineEndings(fullFilePath)
      : 'LF';
    const originalFile = existsSync(fullFilePath)
      ? readFileSync(fullFilePath, enc)
      : '';
    writeTextContent(fullFilePath, updatedFile, enc, endings);

    // Update read timestamp, to invalidate stale writes
    readFileTimestamps[fullFilePath] = statSync(fullFilePath).mtimeMs;

    // Log when editing CLAUDE.md
    if (fullFilePath.endsWith(`${sep}${PROJECT_FILE}`)) {
      logEvent('tengu_write_claudemd', {});
    }

    const data: FileEditToolOutput = {
      filePath: file_path,
      oldString: old_string,
      newString: new_string,
      originalFile,
      structuredPatch: patch,
    };
    yield {
      type: 'result',
      data,
      resultForAssistant: this.renderResultForAssistant(data),
    };
  }

  renderResultForAssistant({ filePath, originalFile, oldString, newString }: FileEditToolOutput): string {
    const { snippet, startLine } = getSnippet(
      originalFile || '',
      oldString,
      newString,
    );
    return `The file ${filePath} has been updated. Here's the result of running \`cat -n\` on a snippet of the edited file:
${addLineNumbers({
  content: snippet,
  startLine,
})}`;
  }
}

export function getSnippet(
  initialText: string,
  oldStr: string,
  newStr: string,
): { snippet: string; startLine: number } {
  const before = initialText.split(oldStr)[0] ?? '';
  const replacementLine = before.split(/\r?\n/).length - 1;
  const newFileLines = initialText.replace(oldStr, () => newStr).split(/\r?\n/);
  // Calculate the start and end line numbers for the snippet
  const startLine = Math.max(0, replacementLine - N_LINES_SNIPPET);
  const endLine =
    replacementLine + N_LINES_SNIPPET + newStr.split(/\r?\n/).length;
  // Get snippet
  const snippetLines = newFileLines.slice(startLine, endLine + 1);
  const snippet = snippetLines.join('\n');
  return { snippet, startLine: startLine + 1 };
}