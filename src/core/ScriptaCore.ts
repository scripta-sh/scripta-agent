// src/core/ScriptaCore.ts

// Define required types from other modules
import { Message, UserMessage, AssistantMessage } from './agent'; // Import from local agent directory (TypeScript will handle the extension)
import { Tool } from './tools/interfaces/Tool'; // Import Tool from core
import { getEnabledTools, getAllTools } from './tools/registry'; // Import registry functions
import { getSystemPrompt } from './constants/prompts';
import { llmService } from './providers'; // Import the provider service
// Define formatSystemPromptWithContext here instead of importing from claude.ts
function formatSystemPromptWithContext(
  systemPrompt: string[],
  context: { [k: string]: string },
): string[] {
  if (Object.entries(context).length === 0) {
    return systemPrompt;
  }

  return [
    ...systemPrompt,
    `\nAs you answer the user's questions, you can use the following context:\n`,
    ...Object.entries(context).map(
      ([key, value]) => `<context name="${key}">${value}</context>`,
    ),
  ];
}

/**
 * Helper function to query the LLM service using the provider system
 * This bridges the old claude.ts interface with the new provider system
 */
async function queryLlmService(
  messages: (UserMessage | AssistantMessage)[],
  systemPrompt: string[],
  maxTokens: number,
  tools: Tool[],
  signal: AbortSignal,
  options: {
    model?: string;
    prependCLISysprompt?: boolean;
    dangerouslySkipPermissions?: boolean;
    [key: string]: any;
  }
): Promise<AssistantMessage> {
  // Simply forward to the llmService from the provider system
  return llmService.query(
    messages,
    systemPrompt,
    maxTokens,
    tools,
    signal,
    options
  );
}
// import { queryOpenAI } from '../services/claude'; // Or wherever it lives
// Need Command type and hasCommand function (define/import later)
// import { Command, hasCommand } from '../commands';
import { AbortController } from 'node-abort-controller';
import { ToolUseBlock, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'; // Import ToolUseBlock and ToolResultBlockParam
import { ISessionManager, SessionState } from './session/ISessionManager'; // Import session manager interface
import { IPermissionHandler, PermissionHandlerContext } from './permissions/IPermissionHandler'; // Import permission handler interface
import { createComponentLogger } from '../utils/log'; 
import { CoreEvent } from './agent/types'; // <-- IMPORT CoreEvent
import { randomUUID } from 'crypto'; // Ensure randomUUID is imported or available

// Create a logger for this component
const logger = createComponentLogger('ScriptaCore');

// Helper to get Tool instance (assuming getToolOrThrow exists and is moved/available)
import { getToolOrThrow } from './tools/registry'; 
import { AbortError } from '../utils/errors'; // Assuming AbortError is available or moved

/**
 * Processes user input and yields core events representing the conversation flow.
 *
 * @param userInput The user's input for this session
 * @param sessionId The unique identifier for the current session.
 * @param sessionManager The manager responsible for handling session state.
 * @param permissionHandler The permission handler for managing permissions
 * @param abortSignal Optional AbortSignal to cancel the operation
 * @param _initialToolResults Optional initial tool results for subsequent LLM calls
 * @yields {CoreEvent} Events representing LLM responses, errors, etc.
 */
export async function* processInput(
    userInput: string,
    sessionId: string,
    sessionManager: ISessionManager,
    permissionHandler: IPermissionHandler,
    abortSignal: AbortSignal,
    _initialToolResults?: ToolResultBlockParam[]
): AsyncGenerator<CoreEvent, void, ToolResultBlockParam | undefined> {

    try { // Wrap entire function in try...finally for final progress update
    // Fetch initial state using the session manager
    const initialState = await sessionManager.getSessionState(sessionId);
    // Use a mutable copy for processing within this turn
        let currentMessagesForTurn: Message[] = [...initialState.messages];

        logger.debug(`[ScriptaCore] Starting processing for session ${sessionId} with ${currentMessagesForTurn.length} initial messages.`);

        // Validate required state properties
        const { currentWorkingDirectory, config, tools: enabledTools } = initialState;
        if (!currentWorkingDirectory) {
            yield { type: 'ErrorOccurred', message: "Current working directory is missing from session state." };
            return;
        }
        if (!config) {
            yield { type: 'ErrorOccurred', message: "Configuration is missing from session state." };
            return;
        }
        if (!enabledTools) {
             yield { type: 'ErrorOccurred', message: "Enabled tools missing from session state." };
             return;
        }
        
        // Expect the latest message to be the user's input for this turn
        const lastMessage = currentMessagesForTurn[currentMessagesForTurn.length - 1];
        if (!lastMessage || lastMessage.type !== 'user') {
             logger.error("[ScriptaCore] Last message in session is not a user message.", { lastMessage });
             yield { type: 'ErrorOccurred', message: "Processing error: Expected user input as the last message." };
             return;
        }
        
        // Log context (use simple logger)
        if (currentMessagesForTurn.length > 1) { // Log context excluding the last user message
            const contextPreview = currentMessagesForTurn.slice(0, -1).slice(-3); // Log last 3 context messages
             logger.debug("[ScriptaCore] Conversation context preview:", contextPreview.map(m => `${m.type.toUpperCase()}: ...`));
        }

        // --- Start: Prepare LLM Call Data ---
        let formattedSystemPromptParts: string[] = [];
        let normalizedMessages: (UserMessage | AssistantMessage)[] = [];
        let modelToUse = config.smallModelName // <-- Use smallModelName instead of fastModelId
        let assistantResponse: AssistantMessage | null = null;
        
        // Get system prompt based on config
        formattedSystemPromptParts = await getSystemPrompt(); // <-- Remove config?.provider argument
        // TODO: Re-introduce context formatting based on SessionState if needed
        // formattedSystemPromptParts = formatSystemPromptWithContext(formattedSystemPromptParts, {}); 

        // --- Initial LLM Call --- 
        normalizedMessages = currentMessagesForTurn as (UserMessage | AssistantMessage)[]; // Assuming type compatibility for now
        // TODO: Add proper normalization logic if needed (e.g., from core utils)

        yield { type: 'ProgressUpdate', status: 'thinking', message: 'Querying LLM...' };
        logger.debug(`[ScriptaCore] Making initial LLM call with ${normalizedMessages.length} messages.`);
        
        try {
                assistantResponse = await queryLlmService(
                    normalizedMessages,
                    formattedSystemPromptParts,
                 config?.largeModelMaxTokens ?? 4096, // Use config value or default
                    enabledTools, 
                 abortSignal,
                    {
                        model: modelToUse, 
                     dangerouslySkipPermissions: false, // <-- Default to false, remove config access
                     // Pass other config options if needed by llmService
                 }
             );
             logger.debug("[ScriptaCore] Received initial LLM response.");
             // Yield AssistantMessageStart event
             yield { type: 'AssistantMessageStart', message: assistantResponse };
        } catch (error: any) {
             logger.error("[ScriptaCore] Error during initial LLM call:", error);
             yield { type: 'ErrorOccurred', message: `LLM API Error: ${error.message}`, error };
             return; // Stop processing on initial LLM error
        }

        // --- Tool Handling Loop --- 
        let toolResults: ToolResultBlockParam[] = [];
        let needsAnotherLlmCall = false;
        let assistantMessageForToolTurn = assistantResponse; // Use the response containing the tools
        
        while (assistantMessageForToolTurn && assistantMessageForToolTurn.message.content.some(c => c.type === 'tool_use')) {
            needsAnotherLlmCall = true; // We'll definitely make a follow-up call
            logger.debug(`[ScriptaCore] Processing tool requests from message ID: ${assistantMessageForToolTurn.message.id}`);
            
            // Add the assistant message containing tool_use blocks to the turn history
            currentMessagesForTurn.push(assistantMessageForToolTurn);

            const toolUseBlocks = assistantMessageForToolTurn.message.content.filter(
                (c): c is ToolUseBlock => c.type === 'tool_use'
            );

            const currentToolResultsForRound: ToolResultBlockParam[] = [];
            
            // Process tool calls (can be parallel later, sequential for now)
            for (const toolUse of toolUseBlocks) {
                let toolResultForBlock: ToolResultBlockParam | undefined = undefined;
                let permissionGranted = false;

                try {
                    const tool = getToolOrThrow(toolUse.name);
                    logger.debug(`[ScriptaCore] Found tool: ${tool.name} for tool_use ID: ${toolUse.id}`);

                    // Prepare permission context
                    const permissionContext: PermissionHandlerContext = {
                        abortSignal: abortSignal,
                        options: { dangerouslySkipPermissions: false /* Read from config/context if needed */ },
                        sessionManager: sessionManager,
                        sessionId: sessionId
                    };
                    // TODO: Link permissionContext.abortController to the main abortSignal?

                    // 1. Check permission
                    logger.debug(`[ScriptaCore] Checking permission for ${tool.name} (ID: ${toolUse.id})`);
                    permissionGranted = await permissionHandler.checkPermission(tool, toolUse.input, permissionContext);
                    logger.debug(`[ScriptaCore] Pre-existing permission for ${tool.name}: ${permissionGranted}`);

                    // 2. Request permission if not already granted
                    if (!permissionGranted) {
                        logger.debug(`[ScriptaCore] Requesting permission for ${tool.name} (ID: ${toolUse.id})`);
                        try {
                            permissionGranted = await permissionHandler.requestPermission(
                                tool,
                                toolUse.input,
                                permissionContext,
                                assistantMessageForToolTurn // Pass the assistant message containing the request
                            );
                            logger.debug(`[ScriptaCore] Permission request result for ${tool.name}: ${permissionGranted}`);
                        } catch (err) {
                            logger.error(`[ScriptaCore] Error during permission request for ${tool.name}:`, err);
                            permissionGranted = false;
                            // Handle potential abort during permission request
                            if (err instanceof AbortError || abortSignal.aborted) {
                                yield { type: 'ErrorOccurred', message: 'Operation cancelled during permission request.', toolUseId: toolUse.id };
                                return; // Stop all processing if aborted during permissions
                            }
                        }
                    }

                    // Check for main abort signal
                    if (abortSignal.aborted) {
                         logger.debug("[ScriptaCore] Aborted before tool execution.");
                         yield { type: 'ErrorOccurred', message: 'Operation cancelled.', toolUseId: toolUse.id };
                         return;
                     }

                    // 3. Handle based on permission result
                    if (permissionGranted) {
                        logger.debug(`[ScriptaCore] Permission granted for ${tool.name}. Yielding ToolRequested.`);
                        yield { type: 'ProgressUpdate', status: 'tool_executing', toolUseId: toolUse.id };
                        
                        // Yield request and wait for result from driving layer
                        const resultFromYield: ToolResultBlockParam | undefined = yield {
                            type: 'ToolRequested',
                            toolUseId: toolUse.id,
                            toolName: toolUse.name,
                            toolInput: toolUse.input
                        };
                        
                        logger.debug(`[ScriptaCore] Resumed after yield for ${toolUse.id}. Result received: ${!!resultFromYield}`);
                        
                        // Check abort again after potentially long tool execution
                        if (abortSignal.aborted) {
                            logger.debug("[ScriptaCore] Aborted after tool execution yield.");
                            yield { type: 'ErrorOccurred', message: 'Operation cancelled.', toolUseId: toolUse.id };
                                        return;
                                    }
        
                        if (resultFromYield) {
                            toolResultForBlock = resultFromYield;
                        } else {
                            // Driving layer didn't send a result (e.g., internal error, cancellation)
                            logger.warn(`[ScriptaCore] No result received from yield for tool ${toolUse.name} (ID: ${toolUse.id}). Treating as error.`);
                            toolResultForBlock = {
                                type: 'tool_result',
                                tool_use_id: toolUse.id,
                                is_error: true,
                                content: 'Tool execution failed or was cancelled by the environment.'
                            };
                        }
                    } else {
                        // Permission denied by handler
                        logger.warn(`[ScriptaCore] Permission denied for tool ${toolUse.name} (ID: ${toolUse.id}).`);
                        yield { type: 'ErrorOccurred', message: 'Permission denied by user.', toolUseId: toolUse.id };
                        toolResultForBlock = {
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            is_error: true,
                            content: 'Permission denied.'
                        };
                    }

                } catch (error: any) {
                    // Catch errors during tool finding, permission checks etc.
                    logger.error(`[ScriptaCore] Error processing tool block ${toolUse.id} (${toolUse.name}):`, error);
                    yield { type: 'ErrorOccurred', message: `Error processing tool ${toolUse.name}: ${error.message}`, error, toolUseId: toolUse.id };
                    toolResultForBlock = {
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        is_error: true,
                        content: `Internal error processing tool: ${error.message}`
                    };
                }
                
                // Add the result (or error block) for this tool to the round's results
                if (toolResultForBlock) {
                     currentToolResultsForRound.push(toolResultForBlock);
                     // Yield confirmation that the result was processed by the core
                     yield { type: 'ToolResultYielded', toolUseId: toolUse.id, result: toolResultForBlock };
                }
            } // End loop over toolUseBlocks for this round

            // Add all results for this round to the message history for the next LLM call
            currentToolResultsForRound.forEach(resultBlock => {
                // Create a User message containing the tool_result block
                // This aligns with how the converter expects to find tool results.
                const toolResultUserMessage: UserMessage = {
                    type: 'user', // Represent tool result submission as user input
                    uuid: randomUUID(),
                    message: {
                        role: 'user',
                        content: [resultBlock] // Embed the ToolResultBlockParam here
                    }
                };
                currentMessagesForTurn.push(toolResultUserMessage);
                logger.debug(`[ScriptaCore] Added ToolResultBlock for ${resultBlock.tool_use_id} wrapped in a user message.`);
            });
            
            // Update session state *incrementally* after processing tool results for the round
            // This allows recovery if a later step fails
            logger.debug(`[ScriptaCore] Saving intermediate session state after tool round.`);
            await sessionManager.setMessages(sessionId, [...currentMessagesForTurn]); // Save copy

            // Prepare and make the next LLM call
            normalizedMessages = currentMessagesForTurn as (UserMessage | AssistantMessage)[];
            yield { type: 'ProgressUpdate', status: 'thinking', message: 'Querying LLM with tool results...' };
            logger.debug(`[ScriptaCore] Making next LLM call with ${normalizedMessages.length} messages.`);

            try {
                 assistantResponse = await queryLlmService(
                     normalizedMessages,
                     formattedSystemPromptParts,
                     config?.largeModelMaxTokens ?? 4096,
                     enabledTools,
                     abortSignal,
                     {
                         model: modelToUse,
                         dangerouslySkipPermissions: false, // <-- Default to false, remove config access
                     }
                 );
                 logger.debug("[ScriptaCore] Received next LLM response.");
                 yield { type: 'AssistantMessageStart', message: assistantResponse };
                 assistantMessageForToolTurn = assistantResponse; // Prepare for potential next loop iteration
            } catch (error: any) {
                 logger.error("[ScriptaCore] Error during next LLM call:", error);
                 assistantMessageForToolTurn = null; // Stop loop on error
                 return;
            }
            
        } // End while loop for tool rounds
        
        // --- Yield Final Assistant Response --- 
        const finalAssistantMessage = assistantMessageForToolTurn; // The last response received (either initial or after tools)
        
        if (finalAssistantMessage) {
            // Ensure the final assistant message is in the turn history if it wasn't a tool-using one
            if (!currentMessagesForTurn.find(m => m.uuid === finalAssistantMessage.uuid)) {
                 currentMessagesForTurn.push(finalAssistantMessage);
            }

            // Yield final text content
            const textContent = finalAssistantMessage.message.content
                .filter(c => c.type === 'text')
                .map(c => (c as { type: 'text'; text: string }).text)
                .join('\n');
            
            if (textContent) {
                logger.debug(`[ScriptaCore] Yielding final AssistantTextResponse: "${textContent.substring(0, 50)}..."`);
                yield { type: 'AssistantTextResponse', text: textContent, messageId: finalAssistantMessage.message.id };
                } else {
                 logger.debug("[ScriptaCore] Final assistant response had no text content (potentially only tool calls).");
                 // If the final response ONLY contained tool calls and the loop didn't run (e.g., all denied),
                 // we might need to yield a specific message here or let the driving layer handle it.
            }
            
            // Yield AssistantMessageEnd event
            yield { type: 'AssistantMessageEnd', message: finalAssistantMessage };

            // --- Save final state --- 
            logger.debug(`[ScriptaCore] Saving final session state with ${currentMessagesForTurn.length} messages.`);
            await sessionManager.setMessages(sessionId, currentMessagesForTurn);

        } else {
             logger.error("[ScriptaCore] No final assistant response available after processing.");
             yield { type: 'ErrorOccurred', message: 'Core Error: No final assistant response generated.' };
        }
        
    } catch (error: any) { // Catch unexpected errors during processing
        logger.error("[ScriptaCore] Unexpected error during processing:", error);
        yield { type: 'ErrorOccurred', message: `Core Processing Error: ${error.message}`, error };
    } finally {
         // Signal that the core is idle
         yield { type: 'ProgressUpdate', status: 'idle' };
         logger.debug(`[ScriptaCore] Finished processing for session ${sessionId}.`);
    }
}
