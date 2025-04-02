import type { CanUseToolFn } from './hooks/useCanUseTool'
import { Tool } from './core/tools'
import { BashTool } from './core/tools/shell'
import { FileEditTool } from './core/tools/filesystem'
import { FileWriteTool } from './core/tools/filesystem'
import { NotebookEditTool } from './core/tools/notebook'
import { getCommandSubcommandPrefix, splitCommand } from './utils/commands'
import {
  getCurrentProjectConfig,
  saveCurrentProjectConfig,
} from './utils/config.js'
import { AbortError } from './utils/errors'
import { logError } from './utils/log'
import { grantWritePermissionForOriginalDir } from './utils/permissions/filesystem'
import { getCwd } from './utils/state'
import { PRODUCT_NAME } from './core/constants/product'
import { renderToolUseMessage } from './cli/renderers/toolRenderers'
import { PermissionHandlerContext } from './core/permissions/IPermissionHandler'

// Commands that are known to be safe for execution
const SAFE_COMMANDS = new Set([
  'git status',
  'git diff',
  'git log',
  'git branch',
  'pwd',
  'tree',
  'date',
  'which',
])

export const bashToolCommandHasExactMatchPermission = (
  tool: Tool,
  command: string,
  allowedTools: string[],
): boolean => {
  if (SAFE_COMMANDS.has(command)) {
    return true
  }
  // Check exact match first
  if (allowedTools.includes(getPermissionKey(tool, { command }, null))) {
    return true
  }
  // Check if command is an exact match with an approved prefix
  if (allowedTools.includes(getPermissionKey(tool, { command }, command))) {
    return true
  }
  return false
}

export const bashToolCommandHasPermission = (
  tool: Tool,
  command: string,
  prefix: string | null,
  allowedTools: string[],
): boolean => {
  // Check exact match first
  if (bashToolCommandHasExactMatchPermission(tool, command, allowedTools)) {
    return true;
  }
  // Check prefix key
  if (prefix && allowedTools.includes(getPermissionKey(tool, { command }, prefix))) {
    return true;
  }
  // Check full command key if prefix check failed or no prefix exists
  if (allowedTools.includes(getPermissionKey(tool, { command }, null))) {
    return true;
  }
  return false; // Return false only if all checks fail
}

export const bashToolHasPermission = async (
  tool: Tool,
  command: string,
  context: PermissionHandlerContext,
  allowedTools: string[],
  getCommandSubcommandPrefixFn = getCommandSubcommandPrefix,
): Promise<PermissionResult> => {
  if (bashToolCommandHasExactMatchPermission(tool, command, allowedTools)) {
    // This is an exact match for a command that is allowed, so we can skip the prefix check
    return { result: true }
  }

  const subCommands = splitCommand(command).filter(_ => {
    // Denim likes to add this, we strip it out so we don't need to prompt the user each time
    if (_ === `cd ${getCwd()}`) {
      return false
    }
    return true
  })
  const commandSubcommandPrefix = await getCommandSubcommandPrefixFn(
    command,
    context.abortSignal,
  )
  if (context.abortSignal.aborted) {
    throw new AbortError()
  }

  if (commandSubcommandPrefix === null) {
    // Fail closed and ask for user approval if the command prefix query failed (e.g. due to network error)
    // This is NOT the same as `fullCommandPrefix.commandPrefix === null`, which means no prefix was detected
    return {
      result: false,
      message: `${PRODUCT_NAME} requested permissions to use ${tool.name}, but you haven't granted it yet.`,
    }
  }

  if (commandSubcommandPrefix.commandInjectionDetected) {
    // Only allow exact matches for potential command injections
    if (bashToolCommandHasExactMatchPermission(tool, command, allowedTools)) {
      return { result: true }
    } else {
      return {
        result: false,
        message: `${PRODUCT_NAME} requested permissions to use ${tool.name}, but you haven't granted it yet.`,
      }
    }
  }

  // If there is only one command, no need to process subCommands
  if (subCommands.length < 2) {
    if (
      bashToolCommandHasPermission(
        tool,
        command,
        commandSubcommandPrefix.commandPrefix,
        allowedTools,
      )
    ) {
      return { result: true }
    } else {
      return {
        result: false,
        message: `${PRODUCT_NAME} requested permissions to use ${tool.name}, but you haven't granted it yet.`,
      }
    }
  }
  if (
    subCommands.every(subCommand => {
      const prefixResult =
        commandSubcommandPrefix.subcommandPrefixes.get(subCommand)
      if (prefixResult === undefined || prefixResult.commandInjectionDetected) {
        // If prefix result is missing or command injection is detected, always ask for permission
        return false
      }
      const hasPermission = bashToolCommandHasPermission(
        tool,
        subCommand,
        prefixResult ? prefixResult.commandPrefix : null,
        allowedTools,
      )
      return hasPermission
    })
  ) {
    return { result: true }
  }
  return {
    result: false,
    message: `${PRODUCT_NAME} requested permissions to use ${tool.name}, but you haven't granted it yet.`,
  }
}

type PermissionResult = { result: true } | { result: false; message: string }

export const hasPermissionsToUseTool: CanUseToolFn = async (
  tool,
  input,
  context: PermissionHandlerContext,
  _assistantMessage,
): Promise<PermissionResult> => {
  // If permissions are being skipped, allow all tools
  if (context.options.dangerouslySkipPermissions) {
    return { result: true }
  }

  if (context.abortSignal.aborted) {
    throw new AbortError()
  }

  // Check if the tool needs permissions
  try {
    if (!tool.needsPermissions(input as never)) {
      return { result: true }
    }
  } catch (e) {
    logError(`Error checking permissions: ${e}`)
    return { result: false, message: 'Error checking permissions' }
  }

  const projectConfig = getCurrentProjectConfig()
  const allowedTools = projectConfig.allowedTools ?? []
  // Special case for BashTool to allow blanket commands without exposing them in the UI
  if (tool.name === 'Bash' && allowedTools.includes(BashTool.name)) {
    return { result: true }
  }

  // TODO: Move this into tool definitions (done for read tools!)
  // Use if/else if based on tool.name instead of switch
  // For bash tool, check each sub-command's permissions separately
  if (tool.name === 'Bash') {
    // The types have already been validated by the tool,
    // so we can safely parse the input (as opposed to safeParse).
    const { command } = tool.inputSchema.parse(input)
    return await bashToolHasPermission(tool, command, context, allowedTools)
  }
  // For file editing tools, check session-only permissions
  else if (tool.name === 'FileEdit' || tool.name === 'FileWrite' || tool.name === 'NotebookEdit') {
    // The types have already been validated by the tool,
    // so we can safely pass this in
    if (!tool.needsPermissions || !tool.needsPermissions(input)) {
      return { result: true }
    }
    return {
      result: false,
      message: `${PRODUCT_NAME} requested permissions to use ${tool.name}, but you haven't granted it yet.`,
    }
  }
  // For other tools, check persistent permissions
  else {
    const permissionKey = getPermissionKey(tool, input, null)
    if (allowedTools.includes(permissionKey)) {
      return { result: true }
    }

    return {
      result: false,
      message: `${PRODUCT_NAME} requested permissions to use ${tool.name}, but you haven't granted it yet.`,
    }
  }
}

export async function savePermission(
  tool: Tool,
  input: { [k: string]: unknown },
  prefix: string | null,
): Promise<void> {
  const key = getPermissionKey(tool, input, prefix)

  // For file editing tools, store write permissions only in memory
  if (
    tool.name === 'FileEdit' ||
    tool.name === 'FileWrite' ||
    tool.name === 'NotebookEdit'
  ) {
    grantWritePermissionForOriginalDir()
    return
  }

  // For other tools, store permissions on disk
  const projectConfig = getCurrentProjectConfig()
  if (projectConfig.allowedTools.includes(key)) {
    return
  }

  projectConfig.allowedTools.push(key)
  projectConfig.allowedTools.sort()

  saveCurrentProjectConfig(projectConfig)
}

function getPermissionKey(
  tool: Tool,
  input: { [k: string]: unknown },
  prefix: string | null,
): string {
  // Use if/else based on name
  if (tool.name === 'Bash') {
    if (prefix) {
      return `${BashTool.name}(${prefix}:*)`
    }
    // Ensure renderToolUseMessage can handle generic Tool input if necessary
    return `${tool.name}(${renderToolUseMessage('Bash', input, false)})`
  }
  else {
    return tool.name
  }
}
