/**
 * Tool execution logic for the agent
 * Migrated from src/query.ts
 */

import { randomUUID } from 'crypto';
import { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs';
import { IPermissionHandler, PermissionHandlerContext } from '../permissions/IPermissionHandler';
import { Message, AssistantMessage, UserMessage, ToolUseContext, MAX_TOOL_USE_CONCURRENCY } from './types';
import { normalizeToolInput, formatError } from './utils';
import { createUserMessage, createProgressMessage, createToolResultStopMessage } from '../../utils/messages';
import { all } from '../../utils/generators';
import { logEvent } from '../../services/statsig';
import { logError } from '../../utils/log';

/**
 * Run multiple tools concurrently if possible
 */
export async function* runToolsConcurrently(
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
  );
}

/**
 * Run tools in serial sequence
 */
export async function* runToolsSerially(
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
    );
  }
}

/**
 * Execute a single tool with permission handling
 */
export async function* runToolUse(
  toolUse: ToolUseBlock,
  siblingToolUseIDs: Set<string>,
  assistantMessage: AssistantMessage,
  permissionHandler: IPermissionHandler,
  toolUseContext: ToolUseContext,
  shouldSkipPermissionCheck?: boolean,
): AsyncGenerator<Message, void> {
  const toolName = toolUse.name;
  const tool = toolUseContext.options.tools.find(t => t.name === toolName);

  // Check if the tool exists
  if (!tool) {
    logEvent('tengu_tool_use_error', {
      error: `No such tool available: ${toolName}`,
      messageID: assistantMessage.message.id,
      toolName,
      toolUseID: toolUse.id,
    });
    yield createUserMessage([
      {
        type: 'tool_result',
        content: `Error: No such tool available: ${toolName}`,
        is_error: true,
        tool_use_id: toolUse.id,
      },
    ]);
    return;
  }

  const toolInput = toolUse.input as { [key: string]: string };

  try {
    if (toolUseContext.abortController.signal.aborted) {
      logEvent('tengu_tool_use_cancelled', {
        toolName: tool.name,
        toolUseID: toolUse.id,
      });
      const message = createUserMessage([
        createToolResultStopMessage(toolUse.id),
      ]);
      yield message;
      return;
    }

    // Validate input types with zod
    // (surprisingly, the model is not great at generating valid input)
    const isValidInput = tool.inputSchema.safeParse(toolInput);
    if (!isValidInput.success) {
      logEvent('tengu_tool_use_error', {
        error: `InputValidationError: ${isValidInput.error.message}`,
        messageID: assistantMessage.message.id,
        toolName: tool.name,
        toolInput: JSON.stringify(toolInput).slice(0, 200),
      });
      yield createUserMessage([
        {
          type: 'tool_result',
          content: `InputValidationError: ${isValidInput.error.message}`,
          is_error: true,
          tool_use_id: toolUse.id,
        },
      ]);
      return;
    }

    const normalizedInput = normalizeToolInput(tool, toolInput);

    // Validate input values. Each tool has its own validation logic
    const isValidCall = await tool.validateInput?.(
      normalizedInput as never,
      toolUseContext,
    );
    if (isValidCall?.result === false) {
      logEvent('tengu_tool_use_error', {
        error: isValidCall?.message.slice(0, 2000),
        messageID: assistantMessage.message.id,
        toolName: tool.name,
        toolInput: JSON.stringify(toolInput).slice(0, 200),
        ...(isValidCall?.meta ?? {}),
      });
      yield createUserMessage([
        {
          type: 'tool_result',
          content: isValidCall!.message,
          is_error: true,
          tool_use_id: toolUse.id,
        },
      ]);
      return;
    }

    // --- PERMISSION LOGIC START ---
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
    // --- PERMISSION LOGIC END ---

    // Permission granted!
    logEvent('tengu_tool_use_executing', { toolName: tool.name });

    // Yield progress message
    const assistantMsgWithToolUse = assistantMessage?.message.content.find(
      c => c.type === 'tool_use' && c.id === toolUse.id,
    );
    if (assistantMsgWithToolUse) {
      // Construct the AssistantMessage object
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
            });
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
            );
            return;
          case 'progress':
            logEvent('tengu_tool_use_progress', {
              messageID: assistantMessage.message.id,
              toolName: tool.name,
            });
            yield createProgressMessage(
              toolUse.id,
              siblingToolUseIDs,
              result.content,
              result.normalizedMessages,
              result.tools,
            );
        }
      }
    } catch (error) {
      const content = formatError(error);
      logError(error);
      logEvent('tengu_tool_use_error', {
        error: content.slice(0, 2000),
        messageID: assistantMessage.message.id,
        toolName: tool.name,
        toolInput: JSON.stringify(toolInput).slice(0, 1000),
      });
      yield createUserMessage([
        {
          type: 'tool_result',
          content,
          is_error: true,
          tool_use_id: toolUse.id,
        },
      ]);
    }
  } catch (e) {
    logError(e);
  }
}