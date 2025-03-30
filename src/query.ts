import {
  Message as APIAssistantMessage,
  MessageParam,
  ToolUseBlock,
  ContentBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { UUID, randomUUID } from 'crypto'
import type { Tool } from './Tool'
import {
  messagePairValidForBinaryFeedback,
  shouldUseBinaryFeedback,
} from './components/binary-feedback/utils.js'
import { CanUseToolFn } from './hooks/useCanUseTool'
import {
  formatSystemPromptWithContext,
  queryAnthropicModel,
  queryOpenAI,
} from './services/claude.js'
import { logEvent } from './services/statsig'
import { all } from './utils/generators'
import { logError } from './utils/log'
import { getGlobalConfig } from './utils/config'
import {
  createAssistantMessage,
  createProgressMessage,
  createToolResultStopMessage,
  createUserMessage,
  FullToolUseResult,
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  NormalizedMessage,
  normalizeMessagesForAPI,
  REJECT_MESSAGE,
} from './utils/messages.js'
import { BashTool } from './tools/BashTool/BashTool'
import { getCwd } from './utils/state'
import { IPermissionHandler, PermissionHandlerContext } from './core/permissions/IPermissionHandler'

export type Response = { costUSD: number; response: string }
export type UserMessage = {
  message: MessageParam
  type: 'user'
  uuid: UUID
  toolUseResult?: FullToolUseResult
}

export type AssistantMessage = {
  costUSD: number
  durationMs: number
  message: APIAssistantMessage
  type: 'assistant'
  uuid: UUID
  isApiErrorMessage?: boolean
}

export type BinaryFeedbackResult =
  | { message: AssistantMessage | null; shouldSkipPermissionCheck: false }
  | { message: AssistantMessage; shouldSkipPermissionCheck: true }

export type ProgressMessage = {
  content: AssistantMessage
  normalizedMessages: NormalizedMessage[]
  siblingToolUseIDs: Set<string>
  tools: Tool[]
  toolUseID: string
  type: 'progress'
  uuid: UUID
}

// Each array item is either a single message or a message-and-response pair
export type Message = UserMessage | AssistantMessage | ProgressMessage

const MAX_TOOL_USE_CONCURRENCY = 10

// Returns a message if we got one, or `null` if the user cancelled
async function queryWithBinaryFeedback(
  toolUseContext: ToolUseContext,
  getAssistantResponse: () => Promise<AssistantMessage>,
  getBinaryFeedbackResponse?: (
    m1: AssistantMessage,
    m2: AssistantMessage,
  ) => Promise<BinaryFeedbackResult>,
): Promise<BinaryFeedbackResult> {
  if (
    process.env.USER_TYPE !== 'ant' ||
    !getBinaryFeedbackResponse ||
    !(await shouldUseBinaryFeedback())
  ) {
    const assistantMessage = await getAssistantResponse()
    if (toolUseContext.abortController.signal.aborted) {
      return { message: null, shouldSkipPermissionCheck: false }
    }
    return { message: assistantMessage, shouldSkipPermissionCheck: false }
  }
  const [m1, m2] = await Promise.all([
    getAssistantResponse(),
    getAssistantResponse(),
  ])
  if (toolUseContext.abortController.signal.aborted) {
    return { message: null, shouldSkipPermissionCheck: false }
  }
  if (m2.isApiErrorMessage) {
    // If m2 is an error, we might as well return m1, even if it's also an error --
    // the UI will display it as an error as it would in the non-feedback path.
    return { message: m1, shouldSkipPermissionCheck: false }
  }
  if (m1.isApiErrorMessage) {
    return { message: m2, shouldSkipPermissionCheck: false }
  }
  if (!messagePairValidForBinaryFeedback(m1, m2)) {
    return { message: m1, shouldSkipPermissionCheck: false }
  }
  return await getBinaryFeedbackResponse(m1, m2)
}

/**
 * The rules of thinking are lengthy and fortuitous. They require plenty of thinking
 * of most long duration and deep meditation for a wizard to wrap one's noggin around.
 *
 * The rules follow:
 * 1. A message that contains a thinking or redacted_thinking block must be part of a query whose max_thinking_length > 0
 * 2. A thinking block may not be the last message in a block
 * 3. Thinking blocks must be preserved for the duration of an assistant trajectory (a single turn, or if that turn includes a tool_use block then also its subsequent tool_result and the following assistant message)
 *
 * Heed these rules well, young wizard. For they are the rules of thinking, and
 * the rules of thinking are the rules of the universe. If ye does not heed these
 * rules, ye will be punished with an entire day of debugging and hair pulling.
 */
export async function* query(
  messages: Message[],
  systemPrompt: string[],
  context: { [k: string]: string },
  permissionHandler: IPermissionHandler,
  toolUseContext: ToolUseContext,
  getBinaryFeedbackResponse?: (
    m1: AssistantMessage,
    m2: AssistantMessage,
  ) => Promise<BinaryFeedbackResult>,
): AsyncGenerator<Message, void> {
  const fullSystemPrompt = formatSystemPromptWithContext(systemPrompt, context)
  function getAssistantResponse() {
    const config = getGlobalConfig()
    const provider = config.primaryProvider
    
    if (provider === 'anthropic') {
      return queryAnthropicModel(
        normalizeMessagesForAPI(messages),
        fullSystemPrompt,
        toolUseContext.options.maxThinkingTokens,
        toolUseContext.options.tools,
        toolUseContext.abortController.signal,
        {
          dangerouslySkipPermissions:
            toolUseContext.options.dangerouslySkipPermissions ?? false,
          model: toolUseContext.options.slowAndCapableModel,
          prependCLISysprompt: true,
        },
      )
    } else {
      // For OpenAI and other providers
      // Import queryOpenAI from claude module
      return import('./services/claude.js').then(({ queryOpenAI }) => queryOpenAI(
        'large',
        normalizeMessagesForAPI(messages),
        fullSystemPrompt,
        toolUseContext.options.maxThinkingTokens,
        toolUseContext.options.tools,
        toolUseContext.abortController.signal,
        {
          dangerouslySkipPermissions:
            toolUseContext.options.dangerouslySkipPermissions ?? false,
          model: toolUseContext.options.slowAndCapableModel,
          prependCLISysprompt: true,
        }
      ))
    }
  }

  const result = await queryWithBinaryFeedback(
    toolUseContext,
    getAssistantResponse,
    getBinaryFeedbackResponse,
  )

  if (result.message === null) {
    yield createAssistantMessage(INTERRUPT_MESSAGE)
    return
  }

  const assistantMessage = result.message
  const shouldSkipPermissionCheck = result.shouldSkipPermissionCheck

  yield assistantMessage

  // @see https://docs.anthropic.com/en/docs/build-with-claude/tool-use
  // Note: stop_reason === 'tool_use' is unreliable -- it's not always set correctly
  const toolUseMessages = assistantMessage.message.content.filter(
    _ => _.type === 'tool_use',
  )

  // If there's no more tool use, we're done
  if (!toolUseMessages.length) {
    return
  }

  const toolResults: UserMessage[] = []

  // Prefer to run tools concurrently, if we can
  // TODO: tighten up the logic -- we can run concurrently much more often than this
  if (
    toolUseMessages.every(msg =>
      toolUseContext.options.tools.find(t => t.name === msg.name)?.isReadOnly(),
    )
  ) {
    for await (const message of runToolsConcurrently(
      toolUseMessages,
      assistantMessage,
      permissionHandler,
      toolUseContext,
      shouldSkipPermissionCheck,
    )) {
      yield message
      // progress messages are not sent to the server, so don't need to be accumulated for the next turn
      if (message.type === 'user') {
        toolResults.push(message)
      }
    }
  } else {
    for await (const message of runToolsSerially(
      toolUseMessages,
      assistantMessage,
      permissionHandler,
      toolUseContext,
      shouldSkipPermissionCheck,
    )) {
      yield message
      // progress messages are not sent to the server, so don't need to be accumulated for the next turn
      if (message.type === 'user') {
        toolResults.push(message)
      }
    }
  }

  if (toolUseContext.abortController.signal.aborted) {
    yield createAssistantMessage(INTERRUPT_MESSAGE_FOR_TOOL_USE)
    return
  }

  // Sort toolResults to match the order of toolUseMessages
  const orderedToolResults = toolResults.sort((a, b) => {
    const aIndex = toolUseMessages.findIndex(
      tu => tu.id === (a.message.content[0] as ToolUseBlock).id,
    )
    const bIndex = toolUseMessages.findIndex(
      tu => tu.id === (b.message.content[0] as ToolUseBlock).id,
    )
    return aIndex - bIndex
  })

  yield* await query(
    [...messages, assistantMessage, ...orderedToolResults],
    systemPrompt,
    context,
    permissionHandler,
    toolUseContext,
    getBinaryFeedbackResponse,
  )
}

async function* runToolsConcurrently(
  toolUseMessages: ToolUseBlock[],
  assistantMessage: AssistantMessage,
  permissionHandler: IPermissionHandler,
  toolUseContext: ToolUseContext,
  shouldSkipPermissionCheck?: boolean,
): AsyncGenerator<Message, void> {
  yield* all(
    toolUseMessages.map(toolUse =>
      runToolUse(
        toolUse,
        new Set(toolUseMessages.map(_ => _.id)),
        assistantMessage,
        permissionHandler,
        toolUseContext,
        shouldSkipPermissionCheck,
      ),
    ),
    MAX_TOOL_USE_CONCURRENCY,
  )
}

async function* runToolsSerially(
  toolUseMessages: ToolUseBlock[],
  assistantMessage: AssistantMessage,
  permissionHandler: IPermissionHandler,
  toolUseContext: ToolUseContext,
  shouldSkipPermissionCheck?: boolean,
): AsyncGenerator<Message, void> {
  for (const toolUse of toolUseMessages) {
    yield* runToolUse(
      toolUse,
      new Set(toolUseMessages.map(_ => _.id)),
      assistantMessage,
      permissionHandler,
      toolUseContext,
      shouldSkipPermissionCheck,
    )
  }
}

export async function* runToolUse(
  toolUse: ToolUseBlock,
  siblingToolUseIDs: Set<string>,
  assistantMessage: AssistantMessage,
  permissionHandler: IPermissionHandler,
  toolUseContext: ToolUseContext,
  shouldSkipPermissionCheck?: boolean,
): AsyncGenerator<Message, void> {
  const toolName = toolUse.name
  const tool = toolUseContext.options.tools.find(t => t.name === toolName)

  // Check if the tool exists
  if (!tool) {
    logEvent('tengu_tool_use_error', {
      error: `No such tool available: ${toolName}`,
      messageID: assistantMessage.message.id,
      toolName,
      toolUseID: toolUse.id,
    })
    yield createUserMessage([
      {
        type: 'tool_result',
        content: `Error: No such tool available: ${toolName}`,
        is_error: true,
        tool_use_id: toolUse.id,
      },
    ])
    return
  }

  const toolInput = toolUse.input as { [key: string]: string }

  try {
    if (toolUseContext.abortController.signal.aborted) {
      logEvent('tengu_tool_use_cancelled', {
        toolName: tool.name,
        toolUseID: toolUse.id,
      })
      const message = createUserMessage([
        createToolResultStopMessage(toolUse.id),
      ])
      yield message
      return
    }

    // Validate input types with zod
    // (surprisingly, the model is not great at generating valid input)
    const isValidInput = tool.inputSchema.safeParse(toolInput)
    if (!isValidInput.success) {
      logEvent('tengu_tool_use_error', {
        error: `InputValidationError: ${isValidInput.error.message}`,
        messageID: assistantMessage.message.id,
        toolName: tool.name,
        toolInput: JSON.stringify(toolInput).slice(0, 200),
      })
      yield createUserMessage([
        {
          type: 'tool_result',
          content: `InputValidationError: ${isValidInput.error.message}`,
          is_error: true,
          tool_use_id: toolUse.id,
        },
      ])
      return
    }

    const normalizedInput = normalizeToolInput(tool, toolInput)

    // Validate input values. Each tool has its own validation logic
    const isValidCall = await tool.validateInput?.(
      normalizedInput as never,
      toolUseContext,
    )
    if (isValidCall?.result === false) {
      logEvent('tengu_tool_use_error', {
        error: isValidCall?.message.slice(0, 2000),
        messageID: assistantMessage.message.id,
        toolName: tool.name,
        toolInput: JSON.stringify(toolInput).slice(0, 200),
        ...(isValidCall?.meta ?? {}),
      })
      yield createUserMessage([
        {
          type: 'tool_result',
          content: isValidCall!.message,
          is_error: true,
          tool_use_id: toolUse.id,
        },
      ])
      return
    }

    // --- CORRECTED PERMISSION LOGIC START ---
    let hasPermission = false;
    // Prepare the simpler context for the permission handler
    const permissionContext: PermissionHandlerContext = {
        abortController: toolUseContext.abortController,
        options: {
            dangerouslySkipPermissions: shouldSkipPermissionCheck
        }
        // NOTE: Add other options if needed by CliPermissionHandler's check/request logic
    };

    if (shouldSkipPermissionCheck) {
        hasPermission = true;
        logEvent('tengu_tool_use_permission_skipped', { toolName: tool.name });
    } else {
        // Step 1: Check if permission already exists
        hasPermission = await permissionHandler.checkPermission(tool, normalizedInput, permissionContext);
        if (!hasPermission) {
            logEvent('tengu_tool_use_permission_requesting', { toolName: tool.name });
            // Step 2: If not, request permission from the user, passing assistantMessage
            hasPermission = await permissionHandler.requestPermission(
               tool, 
               normalizedInput, 
               permissionContext, 
               assistantMessage
            );
        } else {
            // Permission was already granted (e.g., by config)
            logEvent('tengu_tool_use_permission_pre_granted', { toolName: tool.name });
        }
    }

    // Handle result based on hasPermission
    if (!hasPermission) {
      // Permission denied or aborted by user during requestPermission
      // Logging for grant/reject/abort is handled within CliPermissionHandler now
      yield createUserMessage([
         createToolResultStopMessage(toolUse.id),
      ]);
      return;
    }
    // --- CORRECTED PERMISSION LOGIC END ---

    // Permission granted!
    logEvent('tengu_tool_use_executing', { toolName: tool.name });

    // Yield progress message
    const assistantMsgWithToolUse = assistantMessage?.message.content.find(
      c => c.type === 'tool_use' && c.id === toolUse.id,
    );
    if (assistantMsgWithToolUse) {
      // Corrected: Manually construct the AssistantMessage object
      const progressAssistantMessage: AssistantMessage = {
        // Mimic structure of AssistantMessage, but use the specific content block
        type: 'assistant',
        message: {
          id: assistantMessage.message.id, // Use the original message ID
          type: 'message',
          role: 'assistant',
          content: [assistantMsgWithToolUse], // Pass the actual ContentBlock
          model: assistantMessage.message.model,
          stop_reason: assistantMessage.message.stop_reason,
          stop_sequence: assistantMessage.message.stop_sequence,
          usage: { input_tokens: 0, output_tokens: 0 }, // Dummy usage for progress
        },
        costUSD: 0, // No cost for progress message
        durationMs: 0, // No duration for progress message
        uuid: randomUUID(), // Generate new UUID for this message object
      };

      yield createProgressMessage(
        toolUse.id,
        siblingToolUseIDs,
        progressAssistantMessage, // Pass the manually constructed message
        [],
        toolUseContext.options.tools
      );
    }

    // Call the tool
    try {
      // Ensure tool.call only receives input and context
      const generator = tool.call(normalizedInput as never, toolUseContext);
      for await (const result of generator) {
        switch (result.type) {
          case 'result':
            logEvent('tengu_tool_use_success', {
              messageID: assistantMessage.message.id,
              toolName: tool.name,
            })
            yield createUserMessage(
              [
                {
                  type: 'tool_result',
                  content: result.resultForAssistant,
                  tool_use_id: toolUse.id,
                },
              ],
              {
                data: result.data,
                resultForAssistant: result.resultForAssistant,
              },
            )
            return
          case 'progress':
            logEvent('tengu_tool_use_progress', {
              messageID: assistantMessage.message.id,
              toolName: tool.name,
            })
            yield createProgressMessage(
              toolUse.id,
              siblingToolUseIDs,
              result.content,
              result.normalizedMessages,
              result.tools,
            )
        }
      }
    } catch (error) {
      const content = formatError(error)
      logError(error)
      logEvent('tengu_tool_use_error', {
        error: content.slice(0, 2000),
        messageID: assistantMessage.message.id,
        toolName: tool.name,
        toolInput: JSON.stringify(toolInput).slice(0, 1000),
      })
      yield createUserMessage([
        {
          type: 'tool_result',
          content,
          is_error: true,
          tool_use_id: toolUse.id,
        },
      ])
    }
  } catch (e) {
    logError(e)
  }
}

// TODO: Generalize this to all tools
export function normalizeToolInput(
  tool: Tool,
  input: { [key: string]: boolean | string | number },
): { [key: string]: boolean | string | number } {
  switch (tool) {
    case BashTool: {
      const { command, timeout } = BashTool.inputSchema.parse(input) // already validated upstream, won't throw
      return {
        command: command.replace(`cd ${getCwd()} && `, ''),
        ...(timeout ? { timeout } : {}),
      }
    }
    default:
      return input
  }
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }
  const parts = [error.message]
  if ('stderr' in error && typeof error.stderr === 'string') {
    parts.push(error.stderr)
  }
  if ('stdout' in error && typeof error.stdout === 'string') {
    parts.push(error.stdout)
  }
  const fullMessage = parts.filter(Boolean).join('\n')
  if (fullMessage.length <= 10000) {
    return fullMessage
  }
  const halfLength = 5000
  const start = fullMessage.slice(0, halfLength)
  const end = fullMessage.slice(-halfLength)
  return `${start}\n\n... [${fullMessage.length - 10000} characters truncated] ...\n\n${end}`
}

export type ToolUseContext = {
  abortController: AbortController;
  options: {
    dangerouslySkipPermissions?: boolean;
    tools: Tool[];
    maxThinkingTokens?: number;
    slowAndCapableModel?: string;
  };
  readFileTimestamps: Record<string, number>;
};

// Export necessary types and functions
export type { Message, UserMessage, AssistantMessage, ProgressMessage, createUserMessage, query }
