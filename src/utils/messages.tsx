import { randomUUID, UUID } from 'crypto'
import { Box } from 'ink'
import {
  Message,
  ProgressMessage,
  UserMessage,
  AssistantMessage,
} from '../core/agent'
import { getCommand, hasCommand } from '../commands'
import { MalformedCommandError } from './errors'
import { logError } from './log'
import { resolve } from 'path'
import { last, memoize } from 'lodash-es'
import { logEvent } from '../services/statsig'
import { Command } from '../commands.js'
import type { SetToolJSXFn } from '../types/tool-ui'
import type { Tool, ToolUseContext } from '../core/tools'
import { lastX } from '../utils/generators'
import { NO_CONTENT_MESSAGE } from '../core/constants/providerErrors.js'
import {
  ImageBlockParam,
  TextBlockParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
  Message as APIMessage,
  ContentBlockParam,
  ContentBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { setCwd } from './state'
import { getCwd } from './state'
import chalk from 'chalk'
import * as React from 'react'
import { UserBashInputMessage } from '../components/messages/UserBashInputMessage'
import { Spinner } from '../components/Spinner'
import { BashTool } from '../core/tools'
import { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { getContext } from '../context.js'

export const INTERRUPT_MESSAGE = '[Request interrupted by user]'
export const INTERRUPT_MESSAGE_FOR_TOOL_USE =
  '[Request interrupted by user for tool use]'
export const CANCEL_MESSAGE =
  "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed."
export const REJECT_MESSAGE =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."
export const NO_RESPONSE_REQUESTED = 'No response requested.'

export const SYNTHETIC_ASSISTANT_MESSAGES = new Set([
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  CANCEL_MESSAGE,
  REJECT_MESSAGE,
  NO_RESPONSE_REQUESTED,
])

function baseCreateAssistantMessage(
  content: ContentBlock[],
  extra?: Partial<AssistantMessage>,
): AssistantMessage {
  return {
    type: 'assistant',
    costUSD: 0,
    durationMs: 0,
    uuid: randomUUID(),
    message: {
      id: randomUUID(),
      model: '<synthetic>',
      role: 'assistant',
      stop_reason: 'stop_sequence',
      stop_sequence: '',
      type: 'message',
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content,
    },
    ...extra,
  }
}

export function createAssistantMessage(content: string): AssistantMessage {
  return baseCreateAssistantMessage([
    {
      type: 'text' as const,
      text: content === '' ? NO_CONTENT_MESSAGE : content,
      citations: [],
    },
  ])
}

export function createAssistantAPIErrorMessage(
  content: string,
): AssistantMessage {
  return baseCreateAssistantMessage(
    [
      {
        type: 'text' as const,
        text: content === '' ? NO_CONTENT_MESSAGE : content,
        citations: [],
      },
    ],
    { isApiErrorMessage: true },
  )
}

export type FullToolUseResult = {
  data: unknown // Matches tool's `Output` type
  resultForAssistant: ToolResultBlockParam['content']
}

export function createUserMessage(
  content: string | ContentBlockParam[],
  toolUseResult?: FullToolUseResult,
): UserMessage {
  const m: UserMessage = {
    type: 'user',
    message: {
      role: 'user',
      content,
    },
    uuid: randomUUID(),
    toolUseResult,
  }
  return m
}

export function createProgressMessage(
  toolUseID: string,
  siblingToolUseIDs: Set<string>,
  content: AssistantMessage,
  normalizedMessages: (UserMessage | AssistantMessage)[],
  tools: Tool[],
): ProgressMessage {
  return {
    type: 'progress',
    content,
    normalizedMessages,
    siblingToolUseIDs,
    tools,
    toolUseID,
    uuid: randomUUID(),
  }
}

export function createToolResultStopMessage(
  toolUseID: string,
): ToolResultBlockParam {
  return {
    type: 'tool_result',
    content: CANCEL_MESSAGE,
    is_error: true,
    tool_use_id: toolUseID,
  }
}

export async function processUserInput(
  input: string,
  mode: 'bash' | 'prompt',
  setToolJSX: SetToolJSXFn,
  context: ToolUseContext & {
    setForkConvoWithMessagesOnTheNextRender: (
      forkConvoWithMessages: Message[],
    ) => void
  },
  pastedImage: string | null,
): Promise<Message[]> {
  // Bash commands
  if (mode === 'bash') {
    logEvent('tengu_input_bash', {})

    const userMessage = createUserMessage(`<bash-input>${input}</bash-input>`)

    // Special case: cd
    if (input.startsWith('cd ')) {
      const oldCwd = getCwd()
      const newCwd = resolve(oldCwd, input.slice(3))
      try {
        await setCwd(newCwd)
        return [
          userMessage,
          createAssistantMessage(
            `<bash-stdout>Changed directory to ${chalk.bold(`${newCwd}/`)}</bash-stdout>`,
          ),
        ]
      } catch (e) {
        logError(e)
        return [
          userMessage,
          createAssistantMessage(
            `<bash-stderr>cwd error: ${e instanceof Error ? e.message : String(e)}</bash-stderr>`,
          ),
        ]
      }
    }

    // All other bash commands
    setToolJSX({
      jsx: (
        <Box flexDirection="column" marginTop={1}>
          <UserBashInputMessage
            addMargin={false}
            param={{ text: `<bash-input>${input}</bash-input>`, type: 'text' }}
          />
          <Spinner />
        </Box>
      ),
      shouldHidePromptInput: false,
    })
    try {
      const validationResult = await BashTool.validateInput({
        command: input,
      })
      if (!validationResult.result) {
        return [userMessage, createAssistantMessage(validationResult.message)]
      }
      const { data } = await lastX(BashTool.call({ command: input }, context))
      return [
        userMessage,
        createAssistantMessage(
          `<bash-stdout>${data.stdout}</bash-stdout><bash-stderr>${data.stderr}</bash-stderr>`,
        ),
      ]
    } catch (e) {
      return [
        userMessage,
        createAssistantMessage(
          `<bash-stderr>Command failed: ${e instanceof Error ? e.message : String(e)}</bash-stderr>`,
        ),
      ]
    } finally {
      setToolJSX(null)
    }
  }

  // Slash commands
  if (input.startsWith('/')) {
    const words = input.slice(1).split(' ')
    let commandName = words[0]
    if (words.length > 1 && words[1] === '(MCP)') {
      commandName = commandName + ' (MCP)'
    }
    if (!commandName) {
      logEvent('tengu_input_slash_missing', { input })
      return [
        createAssistantMessage('Commands are in the form `/command [args]`'),
      ]
    }

    // Check if it's a real command before processing
    if (!hasCommand(commandName, context.options.commands)) {
      // If not a real command, treat it as a regular user input
      logEvent('tengu_input_prompt', {})
      return [createUserMessage(input)]
    }

    const args = input.slice(commandName.length + 2)
    const newMessages = await getMessagesForSlashCommand(
      commandName,
      args,
      setToolJSX,
      context,
    )

    // Local JSX commands
    if (newMessages.length === 0) {
      logEvent('tengu_input_command', { input })
      return []
    }

    // For invalid commands, preserve both the user message and error
    if (
      newMessages.length === 2 &&
      newMessages[0]!.type === 'user' &&
      newMessages[1]!.type === 'assistant' &&
      typeof newMessages[1]!.message.content === 'string' &&
      newMessages[1]!.message.content.startsWith('Unknown command:')
    ) {
      logEvent('tengu_input_slash_invalid', { input })
      return newMessages
    }

    // User-Assistant pair (eg. local commands)
    if (newMessages.length === 2) {
      logEvent('tengu_input_command', { input })
      return newMessages
    }

    // A valid command
    logEvent('tengu_input_command', { input })
    return newMessages
  }

  // Regular user prompt
  logEvent('tengu_input_prompt', {})
  if (pastedImage) {
    return [
      createUserMessage([
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: pastedImage,
          },
        },
        {
          type: 'text',
          text: input,
        },
      ]),
    ]
  }
  return [createUserMessage(input)]
}

async function getMessagesForSlashCommand(
  commandName: string,
  args: string,
  setToolJSX: SetToolJSXFn,
  context: ToolUseContext & {
    setForkConvoWithMessagesOnTheNextRender: (
      forkConvoWithMessages: Message[],
    ) => void
  },
): Promise<Message[]> {
  try {
    const command = getCommand(commandName, context.options.commands)
    switch (command.type) {
      case 'local-jsx': {
        return new Promise(resolve => {
          command
            .call(r => {
              setToolJSX(null)
              resolve([
                createUserMessage(`<command-name>${command.userFacingName()}</command-name>
          <command-message>${command.userFacingName()}</command-message>
          <command-args>${args}</command-args>`),
                r
                  ? createAssistantMessage(r)
                  : createAssistantMessage(NO_RESPONSE_REQUESTED),
              ])
            }, context)
            .then(jsx => {
              setToolJSX({
                jsx,
                shouldHidePromptInput: true,
              })
            })
        })
      }
      case 'local': {
        const userMessage =
          createUserMessage(`<command-name>${command.userFacingName()}</command-name>
        <command-message>${command.userFacingName()}</command-message>
        <command-args>${args}</command-args>`)

        try {
          const result = await command.call(args, context)

          return [
            userMessage,
            createAssistantMessage(
              `<local-command-stdout>${result}</local-command-stdout>`,
            ),
          ]
        } catch (e) {
          logError(e)
          return [
            userMessage,
            createAssistantMessage(
              `<local-command-stderr>${String(e)}</local-command-stderr>`,
            ),
          ]
        }
      }
      case 'prompt': {
        const prompt = await command.getPromptForCommand(args)
        return prompt.map(_ => {
          if (typeof _.content === 'string') {
            return {
              message: {
                role: _.role,
                content: `<command-message>${command.userFacingName()} is ${command.progressMessage}…</command-message>
                    <command-name>${command.userFacingName()}</command-name>
                    <command-args>${args}</command-args>
                    <command-contents>${JSON.stringify(
                      _.content,
                      null,
                      2,
                    )}</command-contents>`,
              },
              type: 'user',
              uuid: randomUUID(),
            }
          }
          return {
            message: {
              role: _.role,
              content: _.content.map(_ => {
                switch (_.type) {
                  case 'text':
                    return {
                      ..._,
                      text: `
                        <command-message>${command.userFacingName()} is ${command.progressMessage}…</command-message>
                        <command-name>${command.userFacingName()}</command-name>
                        <command-args>${args}</command-args>
                        <command-contents>${JSON.stringify(
                          _,
                          null,
                          2,
                        )}</command-contents>
                      `,
                    }
                  // TODO: These won't render properly
                  default:
                    return _
                }
              }),
            },
            type: 'user',
            uuid: randomUUID(),
          }
        })
      }
    }
  } catch (e) {
    if (e instanceof MalformedCommandError) {
      return [createAssistantMessage(e.message)]
    }
    throw e
  }
}

export function extractTagFromMessage(
  message: Message,
  tagName: string,
): string | null {
  if (message.type === 'progress') {
    return null
  }
  if (typeof message.message.content !== 'string') {
    return null
  }
  return extractTag(message.message.content, tagName)
}

export function extractTag(html: string, tagName: string): string | null {
  if (!html.trim() || !tagName.trim()) {
    return null
  }

  // Escape special characters in the tag name
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Create regex pattern that handles:
  // 1. Self-closing tags
  // 2. Tags with attributes
  // 3. Nested tags of the same type
  // 4. Multiline content
  const pattern = new RegExp(
    `<${escapedTag}(?:\\s+[^>]*)?>` + // Opening tag with optional attributes
      '([\\s\\S]*?)' + // Content (non-greedy match)
      `<\\/${escapedTag}>`, // Closing tag
    'gi',
  )

  let match
  let depth = 0
  let lastIndex = 0
  const openingTag = new RegExp(`<${escapedTag}(?:\\s+[^>]*?)?>`, 'gi')
  const closingTag = new RegExp(`<\\/${escapedTag}>`, 'gi')

  while ((match = pattern.exec(html)) !== null) {
    // Check for nested tags
    const content = match[1]
    const beforeMatch = html.slice(lastIndex, match.index)

    // Reset depth counter
    depth = 0

    // Count opening tags before this match
    openingTag.lastIndex = 0
    while (openingTag.exec(beforeMatch) !== null) {
      depth++
    }

    // Count closing tags before this match
    closingTag.lastIndex = 0
    while (closingTag.exec(beforeMatch) !== null) {
      depth--
    }

    // Only include content if we're at the correct nesting level
    if (depth === 0 && content) {
      return content
    }

    lastIndex = match.index + match[0].length
  }

  return null
}

export function isNotEmptyMessage(message: Message): boolean {
  if (message.type === 'progress') {
    return true
  }

  if (typeof message.message.content === 'string') {
    return message.message.content.trim().length > 0
  }

  if (message.message.content.length === 0) {
    return false
  }

  // Skip multi-block messages for now
  if (message.message.content.length > 1) {
    return true
  }

  if (message.message.content[0]!.type !== 'text') {
    return true
  }

  return (
    message.message.content[0]!.text.trim().length > 0 &&
    message.message.content[0]!.text !== NO_CONTENT_MESSAGE &&
    message.message.content[0]!.text !== INTERRUPT_MESSAGE_FOR_TOOL_USE
  )
}

// Split messages, so each content block gets its own message
export function normalizeMessages(messages: Message[]): (UserMessage | AssistantMessage)[] {
  return messages.flatMap(message => {
    // Filter out ProgressMessage
    if (message.type === 'progress') { return []; }
    // Filter out ToolResultMessage
    if (message.type === 'tool_result') { return []; }

    // --- Add Debug Logging --- 
    if (!message.message) {
        console.error(
            "[normalizeMessages] CRITICAL: Encountered message without nested 'message' property:", 
            JSON.stringify(message, null, 2)
        );
        // Returning [] prevents the crash but hides the root cause. 
        // The real fix is preventing this malformed object from entering the state.
        return []; 
    }
    // --- End Debug Logging ---

    // At this point, message should be UserMessage or AssistantMessage
    // ERROR happens here: implies message.message is undefined
    if (typeof message.message.content === 'string') {
      // Ensure it's a valid NormalizedMessage type before returning
      if (message.type === 'user' || message.type === 'assistant') {
          // Cast to the expected union type for the return value
          return [message] as (UserMessage | AssistantMessage)[];
      } else {
          // Should not happen if types are correct, but handle defensively
          console.warn(`normalizeMessages: Unexpected message type with string content: ${message.type}`);
          return [];
      }
    }

    // Handle array content (should be UserMessage or AssistantMessage)
    if (Array.isArray(message.message.content)) {
        // Map and filter out nulls
        const mappedMessages = message.message.content.map(_ => {
            switch (message.type) {
            case 'assistant':
                // Split assistant message per content block
                return {
                    type: 'assistant',
                    uuid: randomUUID(),
                    message: {
                        ...message.message,
                        content: [_],
                    },
                    costUSD:
                        (message as AssistantMessage).costUSD /
                        message.message.content.length,
                    durationMs: (message as AssistantMessage).durationMs,
                } as AssistantMessage; // Explicitly cast to AssistantMessage
            case 'user':
                // Assuming user messages with array content are returned as is
                // but ensure the type matches the expected return union
                 return message as UserMessage; // Explicitly cast to UserMessage
            default:
                 console.warn(`normalizeMessages: Unexpected message type in map: ${message.type}`);
                 return null; 
            }
        }).filter(m => m !== null);
        
        // Cast the final array to the expected return type
        return mappedMessages as (UserMessage | AssistantMessage)[]; 
    } else {
        console.warn(`normalizeMessages: Unexpected content type for message type ${message.type}:`, message.message.content);
        return []; // Filter out malformed message
    }
  });
}

type ToolUseRequestMessage = AssistantMessage & {
  message: { content: ToolUseBlock[] }
}

function isToolUseRequestMessage(
  message: Message,
): message is ToolUseRequestMessage {
  return (
    message.type === 'assistant' &&
    'costUSD' in message &&
    // Note: stop_reason === 'tool_use' is unreliable -- it's not always set correctly
    message.message.content.some(_ => _.type === 'tool_use')
  )
}

// Re-order, to move result messages to be after their tool use messages
export function reorderMessages(
  messages: (UserMessage | AssistantMessage)[],
): (UserMessage | AssistantMessage)[] {
  const ms: (UserMessage | AssistantMessage)[] = []
  const toolUseMessages: ToolUseRequestMessage[] = []

  for (const message of messages) {
    // track tool use messages we've seen
    if (isToolUseRequestMessage(message)) {
      toolUseMessages.push(message)
    }

    // if it's a tool result, insert it after its tool use message
    if (
      message.type === 'user' &&
      Array.isArray(message.message.content) &&
      message.message.content[0]?.type === 'tool_result'
    ) {
      const toolUseID = (message.message.content[0] as ToolResultBlockParam)
        ?.tool_use_id

      // Check for tool use messages
      const toolUseMessage = toolUseMessages.find(
        _ => _.message.content[0]?.id === toolUseID,
      )
      if (toolUseMessage) {
        ms.splice(ms.indexOf(toolUseMessage) + 1, 0, message)
        continue
      }
      // If no corresponding tool use message found (shouldn't happen?), append at end?
      ms.push(message);

    }

    // otherwise, just add it to the list
    else {
      ms.push(message)
    }
  }

  return ms
}

const getToolResultIDs = memoize(
  (normalizedMessages: (UserMessage | AssistantMessage)[]): { [toolUseID: string]: boolean } =>
    Object.fromEntries(
      normalizedMessages.flatMap(_ =>
        _.type === 'user' && _.message.content[0]?.type === 'tool_result'
          ? [
              [
                _.message.content[0]!.tool_use_id,
                _.message.content[0]!.is_error ?? false,
              ],
            ]
          : ([] as [string, boolean][]),
      ),
    ),
)

export function getUnresolvedToolUseIDs(
  normalizedMessages: (UserMessage | AssistantMessage)[],
): Set<string> {
  const toolResults = getToolResultIDs(normalizedMessages)
  return new Set(
    normalizedMessages
      .filter(
        (
          _,
        ): _ is AssistantMessage & {
          message: { content: [ToolUseBlockParam] }
        } =>
          _.type === 'assistant' &&
          Array.isArray(_.message.content) &&
          _.message.content[0]?.type === 'tool_use' &&
          !(_.message.content[0]?.id in toolResults),
      )
      .map(_ => _.message.content[0].id),
  )
}

/**
 * Tool uses are in flight if they are unresolved.
 * (Removed logic related to progress messages)
 */
export function getInProgressToolUseIDs(
  normalizedMessages: (UserMessage | AssistantMessage)[],
): Set<string> {
  // Progress messages are filtered out, so in-progress is simply unresolved.
  return getUnresolvedToolUseIDs(normalizedMessages);
}

export function getErroredToolUseMessages(
  normalizedMessages: (UserMessage | AssistantMessage)[],
): AssistantMessage[] {
  const toolResults = getToolResultIDs(normalizedMessages)
  return normalizedMessages.filter(
    (_): _ is AssistantMessage =>
      _.type === 'assistant' &&
      Array.isArray(_.message.content) &&
      _.message.content[0]?.type === 'tool_use' &&
      toolResults[_.message.content[0]?.id] === true,
  )
}

export function normalizeMessagesForAPI(
  messages: Message[],
): (UserMessage | AssistantMessage)[] {
  // Start with all messages
  let currentMessages: Message[] = messages;

  // Normalize to split content blocks and filter out progress/tool_results
  let normalized: (UserMessage | AssistantMessage)[] = normalizeMessages(currentMessages);

  // Filter out progress messages again just in case (should be redundant now)
  normalized = normalized.filter(
    message => message.type !== ('progress' as any), // Added type assertion for safety
  );

  // Normalize content for the API (e.g., handle image data)
  normalized = normalized.map(message => {
    if (
      typeof message.message.content !== 'string' &&
      message.message.content?.some(block => block.type === 'image')
    ) {
      return {
        ...message,
        message: {
          ...message.message,
          content: normalizeContentFromAPI(message.message.content),
        },
      } as UserMessage | AssistantMessage; // Ensure cast matches return type
    }
    return message;
  });

  // Reorder messages (ensure reorderMessages handles the UserMessage | AssistantMessage type)
  normalized = reorderMessages(normalized);

  // Filter out system messages if present (unlikely in this context but for safety)
  normalized = normalized.filter(
    message => message.message.role !== 'system'
  );

  // Filter out consecutive user messages (keep only the last one)
  normalized = normalized.reduceRight<(UserMessage | AssistantMessage)[]>(
    (acc, message, index, arr) => {
      if (
        message.message.role === 'user' &&
        index > 0 &&
        arr[index - 1]?.message.role === 'user'
      ) {
        // Skip this user message if the previous one was also a user message
        return acc;
      }
      // Otherwise, add the message to the beginning of the accumulator
      acc.unshift(message);
      return acc;
    },
    [],
  );

  return normalized;
}

// Sometimes the API returns empty messages (eg. "\n\n"). We need to filter these out,
// otherwise they will give an API error when we send them to the API next time we call query().
export function normalizeContentFromAPI(
  content: any
): APIMessage['content'] {
  try {
    // Debug logging for troubleshooting
    if (process.env.NODE_ENV === 'development') {
      console.log('Content in normalizeContentFromAPI:', JSON.stringify(content, null, 2));
    }
    
    // Handle case where content is undefined or null
    if (!content) {
      console.log('Content was null/undefined in normalizeContentFromAPI');
      return [{ type: 'text', text: NO_CONTENT_MESSAGE, citations: [] }];
    }

    // Handle string content (sometimes OpenAI returns just a string)
    if (typeof content === 'string') {
      return [{ type: 'text', text: content || NO_CONTENT_MESSAGE, citations: [] }];
    }

    // For safety, create a default empty array if we have any error
    let contentArray: any[] = [];

    try {
      // Handle both array and non-array content
      contentArray = Array.isArray(content) ? content : [content];
    } catch (err) {
      console.error('Error converting content to array:', err);
      return [{ type: 'text', text: NO_CONTENT_MESSAGE, citations: [] }];
    }

    // Filter safely
    let filteredContent: any[] = [];
    try {
      filteredContent = contentArray.filter(item => {
        if (!item) return false;
        if (typeof item !== 'object') return false;
        if (item.type !== 'text') return true;
        return item.text && item.text.trim && item.text.trim().length > 0;
      });
    } catch (err) {
      console.error('Error filtering content:', err);
      return [{ type: 'text', text: NO_CONTENT_MESSAGE, citations: [] }];
    }

    if (!filteredContent || filteredContent.length === 0) {
      return [{ type: 'text', text: NO_CONTENT_MESSAGE, citations: [] }];
    }

    return filteredContent;
  } catch (err) {
    // Ultimate fallback for any error
    console.error('Unexpected error in normalizeContentFromAPI:', err);
    return [{ type: 'text', text: 'Error processing response', citations: [] }];
  }
}

export function isEmptyMessageText(text: string): boolean {
  return (
    stripSystemMessages(text).trim() === '' ||
    text.trim() === NO_CONTENT_MESSAGE
  )
}
const STRIPPED_TAGS = [
  'commit_analysis',
  'context',
  'function_analysis',
  'pr_analysis',
]

export function stripSystemMessages(content: string): string {
  const regex = new RegExp(`<(${STRIPPED_TAGS.join('|')})>.*?</\\1>\n?`, 'gs')
  return content.replace(regex, '').trim()
}

export function getToolUseID(message: NormalizedMessage): string | null {
  switch (message.type) {
    case 'assistant':
      if (message.message.content[0]?.type !== 'tool_use') {
        return null
      }
      return message.message.content[0].id
    case 'user':
      if (message.message.content[0]?.type !== 'tool_result') {
        return null
      }
      return message.message.content[0].tool_use_id
    case 'progress':
      return message.toolUseID
  }
}

export function getLastAssistantMessageId(
  messages: Message[],
): string | undefined {
  // Iterate from the end of the array to find the last assistant message
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message && message.type === 'assistant') {
      return message.message.id
    }
  }
  return undefined
}
