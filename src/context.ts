import {
  getCurrentProjectConfig,
  saveCurrentProjectConfig,
  GlobalConfig,
} from './utils/config.js'
import { logError } from './utils/log'
import { getCwd } from './utils/state'
import { memoize, omit } from 'lodash-es'
import { LSTool } from './core/tools/filesystem'
import { getIsGit } from './utils/git'
import { ripGrep } from './utils/ripgrep'
import * as path from 'path'
import { execFileNoThrow } from './utils/execFileNoThrow'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { getSlowAndCapableModel } from './utils/model'
import { lastX } from './utils/generators'
import { getGitEmail } from './utils/user'
import { PROJECT_FILE } from './core/constants/product.js'

export function getCodeStyle(config: GlobalConfig): string | null {
  if (!config || !config.preferences || !config.preferences.codeStyle) {
    return null
  }
  return `Coding Style:
Use ${config.preferences.codeStyle.indentStyle} indentation (${config.preferences.codeStyle.indentSize} spaces).
Maximum line length is ${config.preferences.codeStyle.maxLineLength} characters.
Use ${config.preferences.codeStyle.quoteStyle} quotes for strings.
Other guidelines: ${config.preferences.codeStyle.other || 'Follow standard practices for the language.'}`
}

/**
 * Find all KODING.md files in the current working directory
 */
export async function getClaudeFiles(cwd: string): Promise<string | null> {
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 3000)
  try {
    const files = await ripGrep(
      ['--files', '--glob', join('**', '*', PROJECT_FILE)],
      cwd,
      abortController.signal,
    )
    if (!files.length) {
      return null
    }

    // Add instructions for additional KODING.md files
    return `NOTE: Additional ${PROJECT_FILE} files were found. When working in these directories, make sure to read and follow the instructions in the corresponding ${PROJECT_FILE} file:\n${files
      .map(_ => path.join(cwd, _))
      .map(_ => `- ${_}`)
      .join('\n')}`
  } catch (error) {
    logError(error)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export function setContext(key: string, value: string): void {
  const projectConfig = getCurrentProjectConfig()
  const context = omit(
    { ...projectConfig.context, [key]: value },
    'codeStyle',
    'directoryStructure',
  )
  saveCurrentProjectConfig({ ...projectConfig, context })
}

export function removeContext(key: string): void {
  const projectConfig = getCurrentProjectConfig()
  const context = omit(
    projectConfig.context,
    key,
    'codeStyle',
    'directoryStructure',
  )
  saveCurrentProjectConfig({ ...projectConfig, context })
}

export const getReadme = memoize(async (cwd: string): Promise<string | null> => {
  try {
    const readmePath = join(cwd, 'README.md')
    if (!existsSync(readmePath)) {
      return null
    }
    const content = await readFile(readmePath, 'utf-8')
    return content
  } catch (e) {
    logError(e)
    return null
  }
})

export const getGitStatus = memoize(async (cwd: string): Promise<string | null> => {
  if (process.env.NODE_ENV === 'test') {
    // Avoid cycles in tests
    return null
  }
  if (!(await getIsGit())) {
    return null
  }

  try {
    const gitEmail = (await getGitEmail()) || '';
    const [branch, mainBranch, status, log, authorLog] = await Promise.all([
      execFileNoThrow(
        'git',
        ['branch', '--show-current'],
        { cwd },
        undefined,
        false,
      ).then(({ stdout }) => stdout.trim()),
      execFileNoThrow(
        'git',
        ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
        { cwd },
        undefined,
        false,
      ).then(({ stdout }) => stdout.replace('origin/', '').trim()),
      execFileNoThrow(
        'git',
        ['status', '--short'],
        { cwd },
        undefined,
        false,
      ).then(({ stdout }) => stdout.trim()),
      execFileNoThrow(
        'git',
        ['log', '--oneline', '-n', '5'],
        { cwd },
        undefined,
        false,
      ).then(({ stdout }) => stdout.trim()),
      gitEmail ? execFileNoThrow(
        'git',
        [
          'log',
          '--oneline',
          '-n',
          '5',
          '--author',
          gitEmail,
        ],
        { cwd },
        undefined,
        false,
      ).then(({ stdout }) => stdout.trim()) : Promise.resolve(''),
    ])
    // Check if status has more than 200 lines
    const statusLines = status.split('\n').length
    const truncatedStatus =
      statusLines > 200
        ? status.split('\n').slice(0, 200).join('\n') +
          '\n... (truncated because there are more than 200 lines. If you need more information, run "git status" using BashTool)'
        : status

    return `This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.\nCurrent branch: ${branch}\n\nMain branch (you will usually use this for PRs): ${mainBranch}\n\nStatus:\n${truncatedStatus || '(clean)'}\n\nRecent commits:\n${log}\n\nYour recent commits:\n${authorLog || '(no recent commits)'}`
  } catch (error) {
    logError(error)
    return null
  }
})

/**
 * This context is prepended to each conversation, and cached for the duration of the conversation.
 */
export const getContext = memoize(
  async (cwd: string, config: GlobalConfig): Promise<{
    [k: string]: string
  }> => {
    const codeStyle = getCodeStyle(config)
    const dontCrawl = config.dontCrawlDirectory
    const [gitStatus, directoryStructure, claudeFiles, readme] =
      await Promise.all([
        getGitStatus(cwd),
        dontCrawl ? Promise.resolve('') : getDirectoryStructure(cwd),
        dontCrawl ? Promise.resolve('') : getClaudeFiles(cwd),
        getReadme(cwd),
      ])
    return {
      ...(config.context || {}),
      ...(directoryStructure ? { directoryStructure } : {}),
      ...(gitStatus ? { gitStatus } : {}),
      ...(codeStyle ? { codeStyle } : {}),
      ...(claudeFiles ? { claudeFiles } : {}),
      ...(readme ? { readme } : {}),
    }
  },
)

/**
 * Approximate directory structure, to orient Claude. Claude will start with this, then use
 * tools like LS and View to get more information.
 */
export const getDirectoryStructure = memoize(
  async function (cwd: string): Promise<string> {
    let lines: string
    try {
      const abortController = new AbortController()
      setTimeout(() => {
        abortController.abort()
      }, 1_000)
      const model = await getSlowAndCapableModel()
      const resultsGen = LSTool.call(
        {
          path: '.',
        },
        {
          abortController,
          options: {
            commands: [],
            tools: [],
            slowAndCapableModel: model,
            forkNumber: 0,
            messageLogName: 'unused',
            maxThinkingTokens: 0,
          },
          messageId: undefined,
          readFileTimestamps: {},
        },
      )
      const result = await lastX(resultsGen)
      lines = typeof result?.data === 'string' ? result.data : 'Could not retrieve directory structure.';
    } catch (error) {
      logError(error)
      lines = `Error retrieving directory structure: ${error instanceof Error ? error.message : String(error)}`
    }

    return `Below is a snapshot of this project's file structure (from CWD: ${cwd}) at the start of the conversation. This snapshot will NOT update during the conversation.\n\n${lines}`
  },
)
