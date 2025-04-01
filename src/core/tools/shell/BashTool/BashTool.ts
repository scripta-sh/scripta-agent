import { EOL } from 'os'
import { statSync } from 'fs'
import { isAbsolute, relative, resolve } from 'path'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { BaseTool } from '../../base/BaseTool'
import { ToolUseContext } from '../../types'
import { PRODUCT_NAME } from '../../../../core/constants/product'
import { llmService } from '../../../providers'
import { formatOutput, getCommandFilePaths } from './utils'
import { BANNED_COMMANDS, PROMPT } from './prompt'

// Utility imports - will need to be updated as we move more code to core
import { splitCommand } from '../../../../utils/commands'
import { isInDirectory } from '../../../../utils/file'
import { logError } from '../../../../utils/log'
import { PersistentShell } from '../../../../utils/PersistentShell'
import { getCwd, getOriginalCwd } from '../../../../utils/state'
import { getGlobalConfig } from '../../../../utils/config'
import { logEvent } from '../../../../services/statsig'

const inputSchema = z.strictObject({
  command: z.string().describe('The command to execute'),
  timeout: z
    .number()
    .optional()
    .describe('Optional timeout in milliseconds (max 600000)'),
})

type BashToolInput = z.infer<typeof inputSchema>;

export type BashToolOutput = {
  stdout: string
  stdoutLines: number // Total number of lines in original stdout, even if `stdout` is now truncated
  stderr: string
  stderrLines: number // Total number of lines in original stderr, even if `stderr` is now truncated
  interrupted: boolean
}

export class CoreBashTool extends BaseTool {
  name = 'Bash';
  inputSchema = inputSchema;

  async description({ command }: BashToolInput) {
    try {
      const config = getGlobalConfig();
      const userMessage = {
        type: 'user' as const,
        message: {
          content: `Describe this command: ${command}`,
          role: 'user' as const,
          id: randomUUID(),
          type: 'message',
        },
        uuid: randomUUID(),
      };
      
      const systemPrompt = [
        `You are a command description generator. Write a clear, concise description of what this command does in 5-10 words. Examples:

        Input: ls
        Output: Lists files in current directory

        Input: git status
        Output: Shows working tree status

        Input: npm install
        Output: Installs package dependencies

        Input: mkdir foo
        Output: Creates directory 'foo'`,
      ];

      const result = await llmService.query(
        [userMessage],
        systemPrompt,
        1000, // Small token limit is efficient for this task
        [],
        new AbortController().signal,
        {
          model: config.smallModelName, // Use configured small model
          prependCLISysprompt: true,
        }
      );
      
      const description =
        result.message.content[0]?.type === 'text'
          ? result.message.content[0].text
          : null
      return description || 'Executes a bash command'
    } catch (error) {
      logError(error)
      return 'Executes a bash command'
    }
  }

  async prompt() {
    return PROMPT
  }

  isReadOnly(): boolean {
    return false
  }

  userFacingName() {
    return 'Bash'
  }

  async isEnabled() {
    return true
  }

  needsPermissions(): boolean {
    // Always check per-project permissions for BashTool
    return true
  }

  async validateInput({ command }: BashToolInput): Promise<{ result: boolean; message?: string; meta?: Record<string, any> }> {
    const commands = splitCommand(command)
    for (const cmd of commands) {
      const parts = cmd.split(' ')
      const baseCmd = parts[0]

      // Check if command is banned
      if (baseCmd && BANNED_COMMANDS.includes(baseCmd.toLowerCase())) {
        return {
          result: false,
          message: `Command '${baseCmd}' is not allowed for security reasons`,
        }
      }

      // Special handling for cd command
      if (baseCmd === 'cd' && parts[1]) {
        const targetDir = parts[1]!.replace(/^['"]|['"]$/g, '') // Remove quotes if present
        const fullTargetDir = isAbsolute(targetDir)
          ? targetDir
          : resolve(getCwd(), targetDir)
        if (
          !isInDirectory(
            relative(getOriginalCwd(), fullTargetDir),
            relative(getCwd(), getOriginalCwd()),
          )
        ) {
          return {
            result: false,
            message: `ERROR: cd to '${fullTargetDir}' was blocked. For security, ${PRODUCT_NAME} may only change directories to child directories of the original working directory (${getOriginalCwd()}) for this session.`,
          }
        }
      }
    }

    return { result: true }
  }

  renderResultForAssistant({ interrupted, stdout, stderr }: BashToolOutput): string {
    let errorMessage = stderr.trim()
    if (interrupted) {
      if (stderr) errorMessage += EOL
      errorMessage += '<e>Command was aborted before completion</e>'
    }
    const hasBoth = stdout.trim() && errorMessage
    return `${stdout.trim()}${hasBoth ? '\n' : ''}${errorMessage.trim()}`
  }

  async *call(
    { command, timeout = 120000 }: BashToolInput,
    { abortSignal, readFileTimestamps }: ToolUseContext
  ) {
    let stdout = ''
    let stderr = ''

    // Execute commands
    const result = await PersistentShell.getInstance().exec(
      command,
      abortSignal,
      timeout,
    )
    stdout += (result.stdout || '').trim() + EOL
    stderr += (result.stderr || '').trim() + EOL
    if (result.code !== 0) {
      stderr += `Exit code ${result.code}`
    }

    if (!isInDirectory(getCwd(), getOriginalCwd())) {
      // Shell directory is outside original working directory, reset it
      await PersistentShell.getInstance().setCwd(getOriginalCwd())
      stderr = `${stderr.trim()}${EOL}Shell cwd was reset to ${getOriginalCwd()}`
      logEvent('bash_tool_reset_to_original_dir', {})
    }

    // Update read timestamps for any files referenced by the command
    // Don't block the main thread!
    // Skip this in tests because it makes fixtures non-deterministic (they might not always get written),
    // so will be missing in CI.
    if (process.env.NODE_ENV !== 'test') {
      getCommandFilePaths(command, stdout).then(filePaths => {
        for (const filePath of filePaths) {
          const fullFilePath = isAbsolute(filePath)
            ? filePath
            : resolve(getCwd(), filePath)

          // Try/catch in case the file doesn't exist
          try {
            readFileTimestamps[fullFilePath] = statSync(fullFilePath).mtimeMs
          } catch (e) {
            logError(e)
          }
        }
      })
    }

    const { totalLines: stdoutLines, truncatedContent: stdoutContent } =
      formatOutput(stdout.trim())
    const { totalLines: stderrLines, truncatedContent: stderrContent } =
      formatOutput(stderr.trim())

    const data: BashToolOutput = {
      stdout: stdoutContent,
      stdoutLines,
      stderr: stderrContent,
      stderrLines,
      interrupted: result.interrupted,
    }

    yield {
      type: 'result',
      resultForAssistant: this.renderResultForAssistant(data),
      data,
    }
  }
}