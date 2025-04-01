import { Hunk } from 'diff'
import { existsSync, mkdirSync, readFileSync, statSync } from 'fs'
import { EOL } from 'os'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'path'
import { z } from 'zod'
import { BaseTool } from '../../base/BaseTool'
import { ToolUseContext } from '../../types'
import { PROMPT, DESCRIPTION } from './prompt'
import { PROJECT_FILE } from '../../../../core/constants/product'

// Utility imports - will be updated later
import {
  addLineNumbers,
  detectFileEncoding,
  detectLineEndings,
  detectRepoLineEndings,
  writeTextContent,
} from '../../../../utils/file.js'
import { logError } from '../../../../utils/log'
import { getCwd } from '../../../../utils/state'
import { hasWritePermission } from '../../../../utils/permissions/filesystem'
import { getPatch } from '../../../../utils/diff'
import { logEvent } from '../../../../services/statsig'

const MAX_LINES_TO_RENDER = 10
const MAX_LINES_TO_RENDER_FOR_ASSISTANT = 16000
const TRUNCATED_MESSAGE =
  '<response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with Grep in order to find the line numbers of what you are looking for.</NOTE>'

const inputSchema = z.strictObject({
  file_path: z
    .string()
    .describe(
      'The absolute path to the file to write (must be absolute, not relative)',
    ),
  content: z.string().describe('The content to write to the file'),
})

type FileWriteToolInput = z.infer<typeof inputSchema>;

type FileWriteToolOutput = {
  type: 'create' | 'update'
  filePath: string
  content: string
  structuredPatch: Hunk[]
}

export class CoreFileWriteTool extends BaseTool {
  name = 'Replace';
  inputSchema = inputSchema;

  async description() {
    return DESCRIPTION;
  }

  userFacingName() {
    return 'Write';
  }

  async prompt() {
    return PROMPT;
  }

  async isEnabled() {
    return true;
  }

  isReadOnly(): boolean {
    return false;
  }

  needsPermissions({ file_path }: FileWriteToolInput) {
    return !hasWritePermission(file_path);
  }

  async validateInput(
    { file_path }: FileWriteToolInput, 
    { readFileTimestamps }: ToolUseContext
  ) {
    const fullFilePath = isAbsolute(file_path)
      ? file_path
      : resolve(getCwd(), file_path)
    if (!existsSync(fullFilePath)) {
      return { result: true }
    }

    const readTimestamp = readFileTimestamps[fullFilePath]
    if (!readTimestamp) {
      return {
        result: false,
        message:
          'File has not been read yet. Read it first before writing to it.',
      }
    }

    // Check if file exists and get its last modified time
    const stats = statSync(fullFilePath)
    const lastWriteTime = stats.mtimeMs
    if (lastWriteTime > readTimestamp) {
      return {
        result: false,
        message:
          'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.',
      }
    }

    return { result: true }
  }

  async *call(
    { file_path, content }: FileWriteToolInput, 
    { readFileTimestamps, abortSignal }: ToolUseContext
  ) {
    const fullFilePath = isAbsolute(file_path)
      ? file_path
      : resolve(getCwd(), file_path)
    const dir = dirname(fullFilePath)
    const oldFileExists = existsSync(fullFilePath)
    const enc = oldFileExists ? detectFileEncoding(fullFilePath) : 'utf-8'
    const oldContent = oldFileExists ? readFileSync(fullFilePath, enc) : null

    const endings = oldFileExists
      ? detectLineEndings(fullFilePath)
      : await detectRepoLineEndings(getCwd())

    mkdirSync(dir, { recursive: true })
    writeTextContent(fullFilePath, content, enc, endings!)

    // Update read timestamp, to invalidate stale writes
    readFileTimestamps[fullFilePath] = statSync(fullFilePath).mtimeMs

    // Log when writing to CLAUDE.md
    if (fullFilePath.endsWith(`${sep}${PROJECT_FILE}`)) {
      logEvent('tengu_write_claudemd', {})
    }

    if (oldContent) {
      const patch = getPatch({
        filePath: file_path,
        fileContents: oldContent,
        oldStr: oldContent,
        newStr: content,
      })

      const data: FileWriteToolOutput = {
        type: 'update',
        filePath: file_path,
        content,
        structuredPatch: patch,
      }
      yield {
        type: 'result',
        data,
        resultForAssistant: this.renderResultForAssistant(data),
      }
      return
    }

    const data: FileWriteToolOutput = {
      type: 'create',
      filePath: file_path,
      content,
      structuredPatch: [],
    }
    yield {
      type: 'result',
      data,
      resultForAssistant: this.renderResultForAssistant(data),
    }
  }

  renderResultForAssistant({ filePath, content, type }: FileWriteToolOutput): string {
    switch (type) {
      case 'create':
        return `File created successfully at: ${filePath}`
      case 'update':
        return `The file ${filePath} has been updated. Here's the result of running \`cat -n\` on a snippet of the edited file:
${addLineNumbers({
  content:
    content.split(/\r?\n/).length > MAX_LINES_TO_RENDER_FOR_ASSISTANT
      ? content
          .split(/\r?\n/)
          .slice(0, MAX_LINES_TO_RENDER_FOR_ASSISTANT)
          .join('\n') + TRUNCATED_MESSAGE
      : content,
  startLine: 1,
})}`
    }
  }
}