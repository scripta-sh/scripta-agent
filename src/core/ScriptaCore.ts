// src/core/ScriptaCore.ts

// Define required types from other modules (will need adjustment)
import { Message, UserMessage, AssistantMessage } from '../core/agent'; // Using agent types directly
import { createUserMessage, normalizeMessagesForAPI, NormalizedMessage, CANCEL_MESSAGE } from '../utils/messages.js';
import { Tool } from './tools/interfaces/Tool'; // Import Tool from core
import { getEnabledTools, getAllTools } from './tools/registry'; // Import registry functions
import { getContext } from '../context'; // For generating context string
import { getSystemPrompt } from './constants/prompts';
import { getSlowAndCapableModel } from '../utils/model';
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
// import { AbortController } from 'node-abort-controller';
import { ToolUseBlock, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'; // Import ToolUseBlock and ToolResultBlockParam
import { ISessionManager, SessionState } from './session/ISessionManager'; // Import session manager interface
import { createComponentLogger } from '../utils/log'; 
import chalk from 'chalk';

// Create a logger for this component
const logger = createComponentLogger('ScriptaCore');

// Initial CoreEvent definition
export type CoreEvent =
    | { type: 'assistantResponse'; text: string }
    | { type: 'error'; message: string; error?: Error }
    | { type: 'toolRequest'; toolName: string; toolInput: any; toolUseId: string };
    // Add other event types later: toolRequest, progress, etc.

// Helper for conditional logging
const conditionalLog = (message: string, data?: any, verbose = false) => {
    if (verbose) {
        if (data) {
            logger.debug(message, data);
        } else {
            logger.debug(message);
        }
    }
};

// Add a helper function for formatting final response in gray color
function logFinalResponse(text: string) {
    if (process.stdout?.isTTY) {
        // In CLI mode, format the entire message in gray
        const preview = text.substring(0, 50) + (text.length > 50 ? '...' : '');
        console.debug(chalk.gray(`[ScriptaCore] Yielding final response: ${preview}`));
    } else {
        // In non-CLI environment, use standard logging
        logger.debug(`Yielding final response: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
    }
}

// Add a helper for consistent message chain logging
function logMessageChain(messageType: string, messages: Message[]) {
    if (!process.stdout?.isTTY) {
        // In non-CLI environments, use the logger
        logger.debug(`${messageType} ${messages.length} messages:`, 
            messages.map(m => {
                if (m.type === 'progress') {
                    return `PROGRESS: tool-progress`;
                } else {
                    return `${m.type.toUpperCase()}: ${typeof m.message.content === 'string' 
                        ? m.message.content.substring(0, 30) + '...' 
                        : Array.isArray(m.message.content) && m.message.content[0]?.type === 'text'
                          ? (m.message.content[0] as any).text.substring(0, 30) + '...'
                          : 'non-text content'}`;
                }
            })
        );
        return;
    }
    
    // In CLI environment, use chalk directly
    const formattedMessages = messages.map(m => {
        if (m.type === 'progress') {
            return chalk.gray(`PROGRESS: tool-progress`);
        } else {
            return chalk.gray(`${m.type.toUpperCase()}: ${typeof m.message.content === 'string' 
                ? m.message.content.substring(0, 30) + '...' 
                : Array.isArray(m.message.content) && m.message.content[0]?.type === 'text'
                  ? (m.message.content[0] as any).text.substring(0, 30) + '...'
                  : 'non-text content'}`);
        }
    });
    
    console.debug(chalk.gray(`[ScriptaCore] ${messageType} ${messages.length} messages:`), formattedMessages);
}

/**
 * Processes user input and yields core events representing the conversation flow.
 *
 * @param userInput The input string from the user.
 * @param sessionId The unique identifier for the current session.
 * @param sessionManager The manager responsible for handling session state.
 * @param _initialToolResults Optional initial tool results for subsequent LLM calls
 * @yields {CoreEvent} Events representing LLM responses, errors, etc.
 */
export async function* processInput(
    userInput: string,
    sessionId: string,
    sessionManager: ISessionManager,
    _initialToolResults?: ToolResultBlockParam[]
): AsyncGenerator<CoreEvent, void, ToolResultBlockParam | undefined> {

    // Fetch initial state using the session manager
    const initialState = await sessionManager.getSessionState(sessionId);
    // Use a mutable copy for processing within this turn
    const currentMessagesForTurn: Message[] = [...initialState.messages];

    logger.debug(`Starting with ${currentMessagesForTurn.length} messages from previous conversation context`);
    
    // Log the existing context (first few messages)
    if (currentMessagesForTurn.length > 0) {
        const contextPreview = currentMessagesForTurn.slice(0, Math.min(3, currentMessagesForTurn.length));
        conditionalLog("[ScriptaCore] Conversation context:", contextPreview.map(m => {
            if (m.type === 'user') {
                return `USER: ${typeof m.message.content === 'string' ? m.message.content.substring(0, 30) + '...' : 'structured content'}`;
            } else if (m.type === 'assistant') {
                return `ASSISTANT: ${m.message.content[0]?.type === 'text' ? (m.message.content[0] as any).text.substring(0, 30) + '...' : 'structured content'}`;
            } else {
                return `OTHER: ${m.type}`;
            }
        }));
    }

    try {
        let userMessage: Message | null = null;
        let inputType: 'prompt' | 'slashCommand' | 'shellCommand' = 'prompt';

        // Destructure CWD and Config from initialState *before* the try block
        const { currentWorkingDirectory, config } = initialState;

        // Validate required state properties
        if (!currentWorkingDirectory) {
             throw new Error("Current working directory is missing from session state.");
        }
        if (!config) {
             throw new Error("Configuration is missing from session state.");
        }

        // --- Input Processing Logic --- 
        // Note: 'bash' mode distinction is removed for now, relying on '!' prefix
        if (userInput.startsWith('!')) {
            inputType = 'shellCommand';
            // Create user message representing the shell command input
            userMessage = createUserMessage(`<bash-input>${userInput.slice(1)}</bash-input>`);
            // TODO: Later, this might trigger BashTool directly or format differently for LLM
            conditionalLog(`[ScriptaCore] Detected Shell Command: ${userInput.slice(1)}`); // Placeholder Log
        } else if (userInput.startsWith('/')) {
            inputType = 'slashCommand';
            const words = userInput.slice(1).split(' ');
            let commandName = words[0];
            // Handle potential "(MCP)" suffix if needed later
            // if (words.length > 1 && words[1] === '(MCP)') {
            //   commandName = commandName + ' (MCP)';
            // }

            if (!commandName) {
                // Yield an error event for empty command
                yield { type: 'error', message: 'Command name missing. Commands are in the form `/command [args]`.' };
                return; // Stop processing
            }

            // TODO: Check if command exists using hasCommand(commandName, currentState.commands)
            // const commandExists = hasCommand(commandName, currentState.commands);
            const commandExists = false; // Placeholder - Assume command doesn't exist for now

            if (!commandExists) {
                 yield { type: 'error', message: `Unknown command: ${commandName}` };
                 return; // Stop processing
            } else {
                // Command exists - create user message for context
                userMessage = createUserMessage(userInput);
                // TODO: Execute command logic (or yield commandRequest event)
                 conditionalLog(`[ScriptaCore] Detected Slash Command: ${commandName}`); // Placeholder Log
            }

        } else {
            // Default: Treat as a prompt
            inputType = 'prompt';
            // Create standard user message
            userMessage = createUserMessage(userInput);
             conditionalLog(`[ScriptaCore] Detected Prompt`); // Placeholder Log
        }
        // --- End: Input Processing Logic ---

        // Add the processed user message to the session state (local copy)
        if (userMessage) {
            // await sessionManager.addMessage(sessionId, userMessage); // Incorrect
            currentMessagesForTurn.push(userMessage); // Add to local copy
        } else {
             // Handle cases where no user message was created (e.g., invalid command)
             conditionalLog("[ScriptaCore] No user message created for input.");
             yield { type: 'error', message: 'Failed to process user input.'};
             return;
        }

        // --- Start: Prepare LLM Call Data ---
        let formattedSystemPromptParts: string[] = [];
        let normalizedMessages: (UserMessage | AssistantMessage)[] = [];
        let modelToUse: string | undefined = undefined;
        let assistantResponse: AssistantMessage | null = null;
        const abortController = new AbortController();

        if (inputType === 'prompt' || inputType === 'shellCommand') {
            try {
                // 1. Get System Prompt parts and Context
                // CWD and Config are already destructured above

                const [baseSystemPromptParts, contextData] = await Promise.all([
                    getSystemPrompt(), // Assuming this doesn't need session state
                    // Call getContext with cwd and config from session state
                    getContext(currentWorkingDirectory, config),
                ]);

                // 2. Format full system prompt (store string[])
                formattedSystemPromptParts = formatSystemPromptWithContext(baseSystemPromptParts, contextData);

                // 3. Normalize messages for the API - Use local copy
                // const currentMessages = await sessionManager.getMessages(sessionId); // Don't fetch again
                normalizedMessages = normalizeMessagesForAPI(currentMessagesForTurn);

                // Log the normalized messages for debugging
                conditionalLog("[ScriptaCore] Normalized messages for API:", 
                  normalizedMessages.map(m => {
                    return {
                      role: m.message.role,
                      content_type: typeof m.message.content === 'string' 
                        ? 'string' 
                        : Array.isArray(m.message.content) 
                          ? m.message.content.map(c => c.type).join(', ') 
                          : 'unknown',
                      content_preview: typeof m.message.content === 'string'
                        ? m.message.content.substring(0, 50) + (m.message.content.length > 50 ? '...' : '')
                        : Array.isArray(m.message.content) && m.message.content[0]?.type === 'text'
                          ? (m.message.content[0] as any).text.substring(0, 50) + ((m.message.content[0] as any).text.length > 50 ? '...' : '')
                          : 'non-text content',
                      uuid: m.uuid,
                      message_id: m.message.id
                    }
                  })
                );

                // 4. Determine model - Use largeModelName from config retrieved from session state
                modelToUse = config?.largeModelName ?? await getSlowAndCapableModel();

            } catch (e) {
                 conditionalLog("[ScriptaCore] Error preparing LLM call data:", e);
                 yield { type: 'error', message: 'Error preparing data for LLM call.', error: e instanceof Error ? e : undefined };
                 return;
            }
            
            conditionalLog(`[ScriptaCore] Calling LLM: ${normalizedMessages.length} messages, model: ${modelToUse}`);

            // --- Start: Call LLM Service (Moved from query.ts) ---
            try {
                // Determine provider and model from config retrieved from session state
                const provider = config?.primaryProvider ?? 'anthropic';
                // modelToUse is already determined above the try block

                // Get enabled tools from the registry
                const enabledTools = await getEnabledTools();
                
                // Call queryLlmService directly with tools from registry
                assistantResponse = await queryLlmService(
                    normalizedMessages,
                    formattedSystemPromptParts,
                    config?.largeModelMaxTokens ?? 0,
                    enabledTools, 
                    abortController.signal,
                    {
                        model: modelToUse, 
                        // provider: provider, // Assuming queryLlmService infers from model
                        prependCLISysprompt: true, 
                    },
                );

            } catch (e) {
                conditionalLog("[ScriptaCore] Error calling LLM service:", e);
                yield { type: 'error', message: 'Error communicating with LLM.', error: e instanceof Error ? e : undefined };
                return;
            }
            // --- End: Call LLM Service ---

        } 
        // --- End: Prepare LLM Call Data & Call Service ---

        // 4. Yield Events / Handle Tool Results
        if (assistantResponse) {
            // await sessionManager.addMessage(sessionId, assistantResponse); // Incorrect
            currentMessagesForTurn.push(assistantResponse); // Add to local copy
            const toolUseBlocks = assistantResponse.message.content.filter(
                _ => _.type === 'tool_use',
            ) as ToolUseBlock[]

            // Log detected tool calls for debugging
            logger.debug(`Detected ${toolUseBlocks.length} tool calls in assistant response:`);
            if (toolUseBlocks.length > 0) {
                toolUseBlocks.forEach(block => {
                    logger.debug(`Tool call detected: ${block.name} (ID: ${block.id})`);
                });
            }

            if (toolUseBlocks.length > 0) {
                const toolResults: ToolResultBlockParam[] = [];
                for (const block of toolUseBlocks) {
                    // Yield the request and wait for the result from the caller via .next()
                    const toolResult: ToolResultBlockParam | undefined = yield {
                        type: 'toolRequest',
                        toolName: block.name,
                        toolInput: block.input,
                        toolUseId: block.id,
                    };

                    if (toolResult) {
                        conditionalLog(`[ScriptaCore] Received result for ${block.id}:`, {
                            type: toolResult.type,
                            tool_use_id: toolResult.tool_use_id,
                            is_error: toolResult.is_error,
                            contentSize: typeof toolResult.content === 'string' ?
                                `${Math.min(toolResult.content.length, 30)} chars` +
                                (toolResult.content.length > 30 ? '...' : '') : 'object'
                        });
                        
                        // If the tool result indicates an error due to permission denial, exit without making more API calls
                        // For other errors (technical failures), we should still pass the error back to the LLM
                        if (toolResult.is_error && 
                            (toolResult.content.includes('Permission denied') || 
                             toolResult.content === CANCEL_MESSAGE)) {
                            conditionalLog(`[ScriptaCore] Tool permission was denied for ${block.id}. Skipping further LLM calls.`);
                            // Just exit without sending a message - let the UI show just the rejection
                            return; // Exit the generator entirely
                        }
                        
                        toolResults.push(toolResult);
                    } else {
                        // Handle case where caller didn't provide a result (e.g., user cancel)
                        conditionalLog(`[ScriptaCore] No result provided for ${block.id}. Aborting further processing.`);
                         yield { type: 'error', message: `Tool execution aborted or failed for ${block.id}` };
                        // Potentially yield a synthetic message like INTERRUPT_MESSAGE_FOR_TOOL_USE
                        return; // Stop the core engine's turn
                    }

                     // Check for abort signal after potentially long tool execution
                     if (abortController.signal.aborted) {
                         conditionalLog("[ScriptaCore] Aborted after receiving tool result.");
                         // Optionally yield interrupt message
                         return;
                     }
                }

                // --- Start: Second LLM Call Logic ---
                try {
                    // Implement a loop for handling multiple rounds of tool use
                    let continueLlmCalls = true;
                    let currentToolResults = toolResults;
                    
                    while (continueLlmCalls) {
                    // 1. Create the tool result message (User role as per Anthropic spec)
                        const toolResultMessage = createUserMessage(currentToolResults);
                    currentMessagesForTurn.push(toolResultMessage); // Add to local copy

                    // 2. Normalize messages again - Use local copy
                        normalizedMessages = normalizeMessagesForAPI(currentMessagesForTurn);
        
                    // 3. Call LLM service again
                        // Get provider and model from config (modelToUse already available from initial call)
                        const provider = config?.primaryProvider ?? 'anthropic'; 
                        let nextAssistantResponse: AssistantMessage | null = null;

                        // Get enabled tools from the registry (using the same tools as before)
                        // We could cache this but for consistency let's call it again
                        const enabledTools = await getEnabledTools();
                        
                        // Call queryLlmService directly with tools from registry
                        nextAssistantResponse = await queryLlmService(
                            normalizedMessages,
                            formattedSystemPromptParts, 
                            config?.largeModelMaxTokens ?? 0,
                            enabledTools, 
                            abortController.signal, 
                            {
                                model: modelToUse, 
                                // provider: provider, // Assuming queryLlmService infers from model
                                prependCLISysprompt: true,
                            },
                        );

                        // 5. Process the response
                        if (nextAssistantResponse) {
                            // await sessionManager.addMessage(sessionId, nextAssistantResponse); // Incorrect
                            currentMessagesForTurn.push(nextAssistantResponse); // Add to local copy

                            // Check if this response contains tool calls
                        const subsequentToolUseBlocks = nextAssistantResponse.message.content.filter(
                            block => block.type === 'tool_use'
                        ) as ToolUseBlock[];

                        if (subsequentToolUseBlocks.length > 0) {
                                // Handle the next round of tool calls
                                conditionalLog(`[ScriptaCore] Found ${subsequentToolUseBlocks.length} more tool calls, continuing the loop`);
                                
                                // Reset tool results for the next iteration
                                currentToolResults = [];
                                
                                // Process each tool call
                                for (const block of subsequentToolUseBlocks) {
                                    // Yield the request and wait for the result
                                    const toolResult: ToolResultBlockParam | undefined = yield {
                                        type: 'toolRequest',
                                        toolName: block.name,
                                        toolInput: block.input,
                                        toolUseId: block.id,
                                    };
        
                                    if (toolResult) {
                                        conditionalLog(`[ScriptaCore] Received result for ${block.id}:`, {
                                            type: toolResult.type,
                                            tool_use_id: toolResult.tool_use_id,
                                            is_error: toolResult.is_error,
                                            contentSize: typeof toolResult.content === 'string' ?
                                                `${Math.min(toolResult.content.length, 30)} chars` +
                                                (toolResult.content.length > 30 ? '...' : '') : 'object'
                                        });
                                        
                                        // If the tool result indicates an error due to permission denial, exit without making more API calls
                                        // For other errors (technical failures), we should still pass the error back to the LLM
                                        if (toolResult.is_error && 
                                            (toolResult.content.includes('Permission denied') || 
                                             toolResult.content === CANCEL_MESSAGE)) {
                                            conditionalLog(`[ScriptaCore] Tool permission was denied for ${block.id}. Skipping further LLM calls.`);
                                            // Just exit without sending a message - let the UI show just the rejection
                                            return; // Exit the generator entirely
                                        }
                                        
                                        currentToolResults.push(toolResult);
                                    } else {
                                        // Handle case where caller didn't provide a result
                                        conditionalLog(`[ScriptaCore] No result provided for ${block.id}. Aborting further processing.`);
                                        yield { type: 'error', message: `Tool execution aborted or failed for ${block.id}` };
                                        return;
                                    }
        
                                    // Check for abort signal
                                    if (abortController.signal.aborted) {
                                        conditionalLog("[ScriptaCore] Aborted after receiving tool result.");
                                        return;
                                    }
                                }
                                
                                // Continue to the next iteration of the while loop
                                continueLlmCalls = true;
                        } else {
                                // No further tool use, DO NOT yield here - let the final yield handle it
                            const textContent = nextAssistantResponse.message.content.filter(
                                block => block.type === 'text'
                            ).map(block => (block as any).text).join('');
                            
                            // Exit the loop
                            continueLlmCalls = false;
                        }
                    } else {
                         yield { type: 'error', message: 'LLM did not return a response after tool execution.' };
                            continueLlmCalls = false;
                        }
                    }
                } catch (e) {
                    conditionalLog("[ScriptaCore] Error during LLM call loop:", e);
                    yield { type: 'error', message: 'Error during LLM call after tool execution.', error: e instanceof Error ? e : undefined };
                    return;
                }
                // --- End: LLM Call Loop Logic ---

            } else {
                // No tool use - DO NOT yield here, let the final yield handle it
                const textContent = assistantResponse.message.content.filter(
                     block => block.type === 'text'
                ).map(block => (block as any).text).join('');
            }
        } else if (inputType === 'slashCommand') {
             // Simulate command execution result 
             yield { type: 'assistantResponse', text: `[Core Executed Slash Command]: ${userInput}` };
        } else if (inputType === 'prompt') {
             // No assistant response, but it was a prompt (maybe LLM call failed before response?)
             // Yield text from user message as a fallback or handle error appropriately?
             // For now, do nothing extra if assistantResponse is null after prompt
        }

        // Final assistant text response (either initial or after tool use)
        // Track if we've yielded a response already
        const hasYieldedFinalResponse = userInput.startsWith('/') || // We already yielded for slash commands
                                       (inputType === 'prompt' && !assistantResponse); // We haven't yielded anything for normal prompts with null responses

        if (!hasYieldedFinalResponse) {
            const finalResponse = currentMessagesForTurn[currentMessagesForTurn.length - 1] as AssistantMessage | undefined;
            if (finalResponse?.message?.content) {
                const textContent = finalResponse.message.content
                    .filter(block => block.type === 'text')
                    .map(block => (block as any).text)
                    .join('');
                if (textContent) {
                    logFinalResponse(textContent);
                    yield { type: 'assistantResponse', text: textContent };
                }
            }
        }

    } finally {
        // Ensure the final message list is saved back
        await sessionManager.setMessages(sessionId, currentMessagesForTurn);
        logger.debug(`Saved ${currentMessagesForTurn.length} messages for session ${sessionId}. Message chain continuity preserved.`);
        
        // Print the first few and last few messages to help with debugging
        const firstThree = currentMessagesForTurn.slice(0, 3);
        const lastThree = currentMessagesForTurn.slice(-3);
        
        logMessageChain("First", firstThree);
        logMessageChain("Last", lastThree);
        
        // Also print the previous conversations to inspect contextual information
        const savedMessages = await sessionManager.getMessages(sessionId);
        logger.debug(`Session manager returned ${savedMessages.length} messages after saving.`);

        // Log the message chain for debugging
        if (conditionalLog) {
            conditionalLog(`[ScriptaCore] Message chain:`, currentMessagesForTurn.map(m => {
                if (m.type === 'user') {
                    return `USER: ${typeof m.message.content === 'string' ? 
                        m.message.content.substring(0, 50) + (m.message.content.length > 50 ? '...' : '') : 
                        'structured content'}`;
                } else if (m.type === 'assistant') {
                    return `ASSISTANT: ${m.message.content[0]?.type === 'text' ? 
                        (m.message.content[0] as any)?.text?.substring(0, 50) + ((m.message.content[0] as any)?.text?.length > 50 ? '...' : '') : 
                        'structured content'}`;
                } else {
                    return `OTHER: ${m.type}`;
                }
            }));
        }
    }
}
