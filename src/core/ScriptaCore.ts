// src/core/ScriptaCore.ts

// Define required types from other modules (will need adjustment)
import { Message, UserMessage, AssistantMessage } from '../query'; // Assuming Message types from query.ts
import { createUserMessage, normalizeMessagesForAPI, NormalizedMessage, CANCEL_MESSAGE } from '../utils/messages.js';
import { Tool } from '../Tool';
import { getContext } from '../context'; // For generating context string
import { formatSystemPromptWithContext } from '../services/claude'; // <-- Correct path, no extension
import { getSystemPrompt } from '../constants/prompts'; // <-- Remove .ts
import { getSlowAndCapableModel } from '../utils/model'; // <-- Remove .ts
// Import LLM callers and related types/utils
import { queryAnthropicModel } from '../services/claude'; // Assuming this is the correct path now
// import { queryOpenAI } from '../services/claude'; // Or wherever it lives
// Need Command type and hasCommand function (define/import later)
// import { Command, hasCommand } from '../commands';
// import { AbortController } from 'node-abort-controller';
import { ToolUseBlock, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'; // Import ToolUseBlock and ToolResultBlockParam

// Initial SessionState definition
export type SessionState = {
    messages: Message[];
    currentWorkingDirectory: string;
    // Add other relevant state later: config, history, etc.
    tools: Tool[]; // Needed for context/prompt generation
    config?: { // Example - adjust based on actual needs
        dangerouslySkipPermissions?: boolean;
        maxThinkingTokens?: number;
        slowAndCapableModel?: string; // Model might be determined here or passed in
        primaryProvider?: string; // e.g., 'anthropic', 'openai'
    }
};

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
            console.log(message, data);
        } else {
            console.log(message);
        }
    }
};

/**
 * Processes user input and yields core events representing the conversation flow.
 *
 * @param userInput The input string from the user.
 * @param currentState The current state of the session.
 * @param _initialToolResults Optional initial tool results for subsequent LLM calls
 * @yields {CoreEvent} Events representing LLM responses, errors, etc.
 */
export async function* processInput(
    userInput: string,
    currentState: SessionState,
    _initialToolResults?: ToolResultBlockParam[]
): AsyncGenerator<CoreEvent, void, ToolResultBlockParam | undefined> {

    let userMessage: Message | null = null;
    let inputType: 'prompt' | 'slashCommand' | 'shellCommand' = 'prompt';

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

    // Add the processed user message to the session state
    if (userMessage) {
        currentState.messages.push(userMessage);
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
            const [baseSystemPromptParts, contextData] = await Promise.all([
                getSystemPrompt(),
                getContext(currentState.currentWorkingDirectory),
            ]);

            // 2. Format full system prompt (store string[])
            formattedSystemPromptParts = formatSystemPromptWithContext(baseSystemPromptParts, contextData);

            // 3. Normalize messages for the API
            normalizedMessages = normalizeMessagesForAPI(currentState.messages);

            // 4. Determine model
            modelToUse = currentState.config?.slowAndCapableModel ?? await getSlowAndCapableModel();

        } catch (e) {
             conditionalLog("[ScriptaCore] Error preparing LLM call data:", e);
             yield { type: 'error', message: 'Error preparing data for LLM call.', error: e instanceof Error ? e : undefined };
             return;
        }
        
        conditionalLog(`[ScriptaCore] Calling LLM: ${normalizedMessages.length} messages, model: ${modelToUse}`);

        // --- Start: Call LLM Service (Moved from query.ts) ---
        try {
            const provider = currentState.config?.primaryProvider ?? 'anthropic'; // Default to anthropic

            if (provider === 'anthropic') {
                assistantResponse = await queryAnthropicModel(
                    normalizedMessages,
                    formattedSystemPromptParts,
                    currentState.config?.maxThinkingTokens ?? 0,
                    currentState.tools,
                    abortController.signal,
                    {
                        dangerouslySkipPermissions:
                            currentState.config?.dangerouslySkipPermissions ?? false,
                        model: modelToUse, 
                        prependCLISysprompt: true,
                    },
                );
            } else {
                // TODO: Add logic for queryOpenAI or other providers
                 yield { type: 'error', message: `Provider '${provider}' not yet supported in ScriptaCore.` };
                 return;
            }

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
        currentState.messages.push(assistantResponse);
        const toolUseBlocks = assistantResponse.message.content.filter(
            _ => _.type === 'tool_use',
        ) as ToolUseBlock[]

        // Log detected tool calls for debugging
        console.log(`[ScriptaCore] Detected ${toolUseBlocks.length} tool calls in assistant response:`);
        if (toolUseBlocks.length > 0) {
            toolUseBlocks.forEach(block => {
                console.log(`[ScriptaCore] Tool call detected: ${block.name} (ID: ${block.id})`);
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
                currentState.messages.push(toolResultMessage);

                // 2. Normalize messages again
                    normalizedMessages = normalizeMessagesForAPI(currentState.messages);
    
                    // 3. Call LLM service again
                    const provider = currentState.config?.primaryProvider ?? 'anthropic';
                let nextAssistantResponse: AssistantMessage | null = null;

                if (provider === 'anthropic') {
                    nextAssistantResponse = await queryAnthropicModel(
                        normalizedMessages,
                        formattedSystemPromptParts, // Re-use the same system prompt
                        currentState.config?.maxThinkingTokens ?? 0,
                        currentState.tools, // Pass tools again in case of nested tool use
                        abortController.signal, // Re-use the same abort signal
                        {
                            dangerouslySkipPermissions:
                                currentState.config?.dangerouslySkipPermissions ?? false,
                            model: modelToUse, // Re-use the determined model
                            prependCLISysprompt: true,
                        },
                    );
                } else {
                    yield { type: 'error', message: `Provider '${provider}' not yet supported for subsequent calls in ScriptaCore.` };
                    return;
                }

                    // 5. Process the response
                if (nextAssistantResponse) {
                        currentState.messages.push(nextAssistantResponse); // Add the response to messages

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
                            // No further tool use, yield the final text content and exit loop
                        const textContent = nextAssistantResponse.message.content.filter(
                            block => block.type === 'text'
                        ).map(block => (block as any).text).join('');
                        yield { type: 'assistantResponse', text: textContent };
                            
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
            // No tool use, yield the text content
            const textContent = assistantResponse.message.content.filter(
                 block => block.type === 'text'
            ).map(block => (block as any).text).join('');
            yield { type: 'assistantResponse', text: textContent };
        }
    } else if (inputType === 'slashCommand') {
         // Simulate command execution result 
         yield { type: 'assistantResponse', text: `[Core Executed Slash Command]: ${userInput}` };
    }
}
