/**
 * Core conversation agent implementation
 * Migrated from src/query.ts
 */

import { randomUUID } from 'crypto';
import { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs';
import { IPermissionHandler } from '../permissions/IPermissionHandler';
import { Message, AssistantMessage, UserMessage, ToolUseContext, BinaryFeedbackResult } from './types';
import { queryWithBinaryFeedback } from './utils';
import { runToolsConcurrently, runToolsSerially } from './ToolExecutor';
import { createAssistantMessage } from '../../utils/messages.js';
import { normalizeMessagesForAPI } from '../../utils/messages';
import { formatSystemPromptWithContext } from '../constants/providerErrors';
import { llmService } from '../providers';
import { INTERRUPT_MESSAGE, INTERRUPT_MESSAGE_FOR_TOOL_USE } from '../../utils/messages';

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
  const fullSystemPrompt = formatSystemPromptWithContext(systemPrompt, context);
  
  // Function to get a response from the LLM
  function getAssistantResponse() {
    // Use llmService directly from core/providers
    return llmService.query(
      normalizeMessagesForAPI(messages),
      fullSystemPrompt,
      toolUseContext.options.maxThinkingTokens || 4000,
      toolUseContext.options.tools,
      toolUseContext.abortController.signal,
      {
        dangerouslySkipPermissions:
          toolUseContext.options.dangerouslySkipPermissions ?? false,
        model: toolUseContext.options.slowAndCapableModel,
        prependCLISysprompt: true,
      }
    );
  }

  // Get a response, possibly with binary feedback
  const result = await queryWithBinaryFeedback(
    toolUseContext,
    getAssistantResponse,
    getBinaryFeedbackResponse,
  );

  // Handle aborted request
  if (result.message === null) {
    yield createAssistantMessage(INTERRUPT_MESSAGE);
    return;
  }

  const assistantMessage = result.message;
  const shouldSkipPermissionCheck = result.shouldSkipPermissionCheck;

  // Yield the initial assistant message
  yield assistantMessage;

  // @see https://docs.anthropic.com/en/docs/build-with-claude/tool-use
  // Note: stop_reason === 'tool_use' is unreliable -- it's not always set correctly
  const toolUseMessages = assistantMessage.message.content.filter(
    _ => _.type === 'tool_use',
  ) as ToolUseBlock[];

  // If there's no more tool use, we're done
  if (!toolUseMessages.length) {
    return;
  }

  const toolResults: UserMessage[] = [];

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
      yield message;
      // progress messages are not sent to the server, so don't need to be accumulated for the next turn
      if (message.type === 'user') {
        toolResults.push(message);
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
      yield message;
      // progress messages are not sent to the server, so don't need to be accumulated for the next turn
      if (message.type === 'user') {
        toolResults.push(message);
      }
    }
  }

  // Handle aborted request after tool execution
  if (toolUseContext.abortController.signal.aborted) {
    yield createAssistantMessage(INTERRUPT_MESSAGE_FOR_TOOL_USE);
    return;
  }

  // Sort toolResults to match the order of toolUseMessages
  const orderedToolResults = toolResults.sort((a, b) => {
    const aIndex = toolUseMessages.findIndex(
      tu => tu.id === (a.message.content[0] as ToolUseBlock).id,
    );
    const bIndex = toolUseMessages.findIndex(
      tu => tu.id === (b.message.content[0] as ToolUseBlock).id,
    );
    return aIndex - bIndex;
  });

  // Recursively continue the conversation with the tool results
  yield* await query(
    [...messages, assistantMessage, ...orderedToolResults],
    systemPrompt,
    context,
    permissionHandler,
    toolUseContext,
    getBinaryFeedbackResponse,
  );
}