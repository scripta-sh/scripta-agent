import { ToolUseBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { Box, Newline, Static, Text, useApp, useInput, useStdin } from 'ink'
import ProjectOnboarding, {
  markProjectOnboardingComplete,
} from '../ProjectOnboarding.js'
import { CostThresholdDialog } from '../components/CostThresholdDialog'
import * as React from 'react'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useTerminalSize } from '../hooks/useTerminalSize'
import { Command } from '../commands'
import { Logo } from '../components/Logo'
import { Message } from '../components/Message'
import { MessageResponse } from '../components/MessageResponse'
import { MessageSelector } from '../components/MessageSelector'
import {
  PermissionRequest,
  ToolUseConfirm,
} from '../components/permissions/PermissionRequest'
import { PermissionRequestTitle } from '../components/permissions/PermissionRequestTitle'
import PromptInput from '../components/PromptInput'
import { Spinner } from '../components/Spinner'
import { getSystemPrompt } from '../core/constants/prompts.js'
import { getContext } from '../context'
import { getTotalCost, useCostSummary } from '../cost-tracker'
import { useLogStartupTime } from '../hooks/useLogStartupTime'
import { addToHistory } from '../history'
import { useCancelRequest } from '../hooks/useCancelRequest'
import { useLogMessages } from '../hooks/useLogMessages'
import { getTheme } from '../utils/theme'
import { HighlightedCode } from '../components/HighlightedCode'
import { StructuredDiff } from '../components/StructuredDiff'
import { intersperse } from '../utils/array'
import { existsSync, readFileSync } from 'fs'
import { relative, basename, extname } from 'path'
import { getPatch } from '../utils/diff'
import { detectFileEncoding } from '../utils/file'
import {
  type AssistantMessage,
  type BinaryFeedbackResult,
  type Message as MessageType,
  type ProgressMessage,
  type UserMessage,
} from '../core/agent'
import type { WrappedClient } from '../services/mcpClient'
import type { Tool } from '../core/tools'
import { getTool, getToolOrThrow } from '../core/tools'
import { AutoUpdaterResult } from '../utils/autoUpdater'
import { logEvent } from '../services/statsig'
import { getNextAvailableLogForkNumber } from '../utils/log'
import {
  getErroredToolUseMessages,
  getInProgressToolUseIDs,
  getLastAssistantMessageId,
  getToolUseID,
  getUnresolvedToolUseIDs,
  INTERRUPT_MESSAGE,
  isNotEmptyMessage,
  normalizeMessages,
  normalizeMessagesForAPI,
  reorderMessages,
  createAssistantMessage,
  createAssistantAPIErrorMessage,
  createUserMessage,
} from '../utils/messages.js'
import { getSlowAndCapableModel, isDefaultSlowAndCapableModel } from '../utils/model'
import { clearTerminal, updateTerminalTitle } from '../utils/terminal'
import { BinaryFeedback } from '../components/binary-feedback/BinaryFeedback'
import { getMaxThinkingTokens } from '../utils/thinking'
import { CliPermissionHandler } from '../cli/permissions/CliPermissionHandler'
import { getCwd, getOriginalCwd } from '../utils/state'
import { getClients } from '../services/mcpClient.js'
import { CliConfigService } from '../cli/config/CliConfigService'
import { processInput } from '../core/ScriptaCore'
import { CoreEvent } from '../core/agent/types'
import { IPermissionHandler, PermissionHandlerContext } from "../core/permissions/IPermissionHandler";
import { ToolUseContext } from '../core/tools/interfaces/Tool';
import { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { PermissionRequest as ToolUseConfirmComponent } from '../components/permissions/PermissionRequest'
import { CliSessionManager } from '../cli/session/CliSessionManager'
import { setMessagesGetter, setMessagesSetter } from '../messages'
import chalk from 'chalk'
import { createComponentLogger } from '../utils/log'

type Props = {
  commands: Command[]
  dangerouslySkipPermissions?: boolean
  debug?: boolean
  initialForkNumber?: number | undefined
  initialPrompt: string | undefined
  // A unique name for the message log file, used to identify the fork
  messageLogName: string
  shouldShowPromptInput: boolean
  tools: Tool[]
  verbose: boolean | undefined
  // Initial messages to populate the REPL with
  initialMessages?: MessageType[]
  // MCP clients
  mcpClients?: WrappedClient[]
  // Flag to indicate if current model is default
  isDefaultModel?: boolean
}

// --- Define PermissionRequest type locally --- 
interface PermissionRequest {
    toolName: string;
    toolInput: any;
    onAllow: () => void;
    onDeny: () => void;
}

// --- Permission Prompt Component uses local type --- 
interface PermissionPromptProps {
    request: PermissionRequest | null;
}

// Create a logger for this component
const logger = createComponentLogger('REPL');

export function REPL({
  commands,
  dangerouslySkipPermissions,
  debug = false,
  initialForkNumber = 0,
  initialPrompt,
  messageLogName,
  shouldShowPromptInput,
  tools,
  verbose: verboseFromCLI,
  initialMessages,
  mcpClients = [],
  isDefaultModel = true,
}: Props): React.ReactNode {
  // Instantiate Config Service
  const configService = useMemo(() => new CliConfigService(), []);

  // Use configService for verbose flag
  const verbose = verboseFromCLI ?? configService.getGlobalConfig().verbose
  
  // --- Conditionally log based on verbosity ---
  const conditionalLog = (message: string, data?: any) => {
    if (verbose) {
      if (data) {
        console.log(message, data);
      } else {
        console.log(message);
      }
    }
  };

  // Used to force the logo to re-render and conversation log to use a new file
  const [forkNumber, setForkNumber] = useState(
    getNextAvailableLogForkNumber(messageLogName, initialForkNumber, 0),
  )

  const [
    forkConvoWithMessagesOnTheNextRender,
    setForkConvoWithMessagesOnTheNextRender,
  ] = useState<MessageType[] | null>(null)

  const [abortController, setAbortController] =
    useState<AbortController | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [autoUpdaterResult, setAutoUpdaterResult] =
    useState<AutoUpdaterResult | null>(null)
  // Use the new type definition
  const [toolJSX, setToolJSX] = useState<import('../types/tool-ui').ToolJSX | null>(null)
  const [toolUseConfirm, setToolUseConfirm] = useState<ToolUseConfirm | null>(
    null,
  )
  const [messages, setMessages] = useState<MessageType[]>(initialMessages ?? [])
  const [inputValue, setInputValue] = useState('')
  const [inputMode, setInputMode] = useState<'bash' | 'prompt'>('prompt')
  const [submitCount, setSubmitCount] = useState(0)
  const [isMessageSelectorVisible, setIsMessageSelectorVisible] =
    useState(false)
  const [showCostDialog, setShowCostDialog] = useState(false)
  const [haveShownCostDialog, setHaveShownCostDialog] = useState(
    configService.getGlobalConfig().hasAcknowledgedCostThreshold,
  )

  const [binaryFeedbackContext, setBinaryFeedbackContext] =
    useState<any | null>(null)

  const { isRawModeSupported } = useStdin()
  const readFileTimestamps = useRef(new Map<string, number>())
  const { exit } = useApp()
  // const { getBinaryFeedbackResponse } = useBinaryFeedback(messages)
  // MCP State
  // const { mcpClients, isDefaultModel } = useMCP()

  // Add state for logo data
  const [mcpClientState, setMcpClientState] = useState<WrappedClient[]>([]);
  const [isDefaultModelState, setIsDefaultModelState] = useState<boolean>(true);

  // Log state changes
  const loggedSetIsLoading = useCallback((value: boolean) => {
    logger.debug(`Setting isLoading to: ${value}`);
    setIsLoading(value);
  }, [setIsLoading]);

  const loggedSetToolUseConfirm = useCallback((value: ToolUseConfirm | null) => {
    logger.debug(`Setting toolUseConfirm to: ${value ? `Object (Tool: ${value.tool.name})` : 'null'}`);
    setToolUseConfirm(value);
  }, [setToolUseConfirm]);
  
  // Define coreEngineRef at the top level
  const coreEngineRef = useRef<AsyncGenerator<CoreEvent, void, ToolResultBlockParam | undefined> | null>(null);

  // Move the sessionManager initialization first
  // --- Instantiate Session Manager --- 
  // Use useMemo to instantiate only once, relies on getters/setters being set by the useEffect above
  const sessionManager = useMemo(() => new CliSessionManager(), []);

  // Initialize message getters/setters - update the getter whenever messages change
  useEffect(() => {
    setMessagesGetter(() => messages); // Provide the current state - will return the latest messages
    setMessagesSetter(setMessages);   // Provide the state setter
    
    // Log for debugging
    logger.debug(`Updated messages getter with ${messages.length} messages`);
    if (messages.length > 0) {
      logger.debug(`First message: ${messages[0].type} | Last message: ${messages[messages.length-1].type}`);
    }
  }, [messages]);  // Re-run when messages change to ensure getter returns latest state

  // Add a separate effect to sync the session state, with a flag to prevent infinite loops
  const [shouldSyncMessages, setShouldSyncMessages] = useState(false);

  useEffect(() => {
    if (shouldSyncMessages && messages.length > 0) {
      // Reset flag first to prevent loops
      setShouldSyncMessages(false);
      
      // Use a constant session ID since CLI only has one session
      logger.debug(`Syncing messages with session manager ${messages.length}`);
      sessionManager.setMessages('cli-session', messages)
        .then(() => logger.debug(`Successfully synced messages with session manager ${messages.length}`))
        .catch(err => logger.error(`Failed to sync messages with session manager:`, err));
    }
  }, [shouldSyncMessages, messages, sessionManager]);
  
  // MCP State & related hooks... (ensure these are declared before use)
  // MCP State & related hooks... (ensure these are declared before use)

  // Instantiate the permission handler (Uses the original state setters)
  const permissionHandler = useMemo(() => {
    logger.debug(`Creating CliPermissionHandler with permission request state setter`);
    return new CliPermissionHandler(
      // For tool use confirmation - use logged setter
      loggedSetToolUseConfirm, 
      // Pass null or a dummy function for the simple prompt setter (no longer used)
      () => {} // Or pass loggedSetPermissionRequest if keeping state temporarily
    );
  }, [loggedSetToolUseConfirm /* Remove loggedSetPermissionRequest dependency if state removed */ ]);

  // Effect to fetch logo data
  useEffect(() => {
    let isMounted = true;
    
    const fetchData = async () => {
      try {
        const [clients, isDefault] = await Promise.all([
          getClients(),
          isDefaultSlowAndCapableModel()
        ]);
        if (isMounted) {
          setMcpClientState(clients);
          setIsDefaultModelState(isDefault);
        }
      } catch (error) {
         logger.error("Failed to fetch data for Logo:", error);
         // Optionally set an error state
      }
    };

    fetchData();

    return () => { isMounted = false; }; // Cleanup function
  }, []); // Empty dependency array means run once on mount

  function onCancel() {
    if (!isLoading) {
      return
    }
    // Use logged setter
    loggedSetIsLoading(false)
    if (toolUseConfirm) {
      // Tool use confirm handles the abort signal itself
      toolUseConfirm.onAbort()
    } else {
      abortController?.abort()
    }
  }

  useCancelRequest(
    setToolJSX,
    setToolUseConfirm,
    setBinaryFeedbackContext,
    onCancel,
    isLoading,
    isMessageSelectorVisible,
    abortController?.signal,
  )

  useEffect(() => {
    if (forkConvoWithMessagesOnTheNextRender) {
      setForkNumber(_ => _ + 1)
      setForkConvoWithMessagesOnTheNextRender(null)
      setMessages(forkConvoWithMessagesOnTheNextRender)
    }
  }, [forkConvoWithMessagesOnTheNextRender])

  useEffect(() => {
    const totalCost = getTotalCost()
    if (totalCost >= 5 /* $5 */ && !showCostDialog && !haveShownCostDialog) {
      logEvent('tengu_cost_threshold_reached', {})
      setShowCostDialog(true)
    }
  }, [messages, showCostDialog, haveShownCostDialog])

  async function onInit() {
    // Exit if no initial prompt
    if (!initialPrompt) {
      return
    }

    setIsLoading(true)

    const abortController = new AbortController()
    setAbortController(abortController)
    
    // Add to history
    addToHistory(initialPrompt)
    
    try {
      // Define a constant session ID for the CLI
      const sessionId = 'cli-session';
      
      // Create user message from initial prompt
      const userMessage = createUserMessage(initialPrompt);
      
      // Get current session state
      const currentState = await sessionManager.getSessionState(sessionId);
      logger.debug(`onInit: Session state has ${currentState.messages.length} messages`);
      
      // Add user message to session
      await sessionManager.setMessages(sessionId, [...currentState.messages, userMessage]);
      
      // Update React state to show the user message
      setMessages(messages => [...messages, userMessage]);
      
      // Call the ScriptaCore processInput function
      logger.debug(`onInit: Initializing ScriptaCore with prompt: ${initialPrompt.substring(0, 30)}${initialPrompt.length > 30 ? '...' : ''}`);
      coreEngineRef.current = processInput(
        initialPrompt,
        sessionId,
        sessionManager,
        permissionHandler,
        abortController.signal
      );
      
      // Process events from the core engine
      let nextToolResult: ToolResultBlockParam | undefined = undefined;
      while (true) {
        if (!coreEngineRef.current) break; // Guard against null ref
        
        const { value: coreEvent, done } = await coreEngineRef.current.next(nextToolResult);
        nextToolResult = undefined;
        
        if (done) {
          logger.debug(`Core engine processing finished.`);
          break;
        }
        
        if (coreEvent) {
          nextToolResult = await handleCoreEvent(coreEvent, abortController);
        } else {
          logger.debug(`Received undefined event from core generator.`);
        }
      }
    } catch (error) {
      logger.error(`Error in onInit:`, error);
      // Add error message to the chat
      const errorMessage = createAssistantAPIErrorMessage(
        `An error occurred while processing your input: ${error instanceof Error ? error.message : String(error)}`
      );
      setMessages(messages => [...messages, errorMessage]);
    } finally {
      setHaveShownCostDialog(
        configService.getGlobalConfig().hasAcknowledgedCostThreshold || false,
      );
      
      setIsLoading(false);
      setAbortController(null);
    }
  }

  const handleCoreEvent = useCallback(async (
      coreEvent: CoreEvent, 
      abortController: AbortController // Pass the main abort controller
  ): Promise<ToolResultBlockParam | undefined> => {
    logger.debug(`Handling CoreEvent: ${coreEvent.type}`, coreEvent);

    switch (coreEvent.type) {
      case 'AssistantTextResponse':
        // Update UI with streaming text
        // Find the latest assistant message being streamed (might need better tracking)
        setMessages(prevMessages => {
            const lastMsgIndex = prevMessages.length - 1;
            if (lastMsgIndex >= 0 && prevMessages[lastMsgIndex]?.type === 'assistant') {
                const updatedMessages = [...prevMessages];
                const lastMsg = updatedMessages[lastMsgIndex] as AssistantMessage; // Cast needed
                // Append text to the last message content if it's a text block
                const content = lastMsg.message.content;
                if (content.length > 0 && content[content.length - 1]?.type === 'text') {
                    content[content.length - 1]!.text += coreEvent.text; 
        } else {
                    // Or add a new text block if the last block wasn't text
                    content.push({ type: 'text', text: coreEvent.text });
                }
                updatedMessages[lastMsgIndex] = { ...lastMsg }; // Ensure re-render
                return updatedMessages;
            }
            // If no assistant message exists yet, create a placeholder? Or wait for AssistantMessageStart?
             logger.warn("Received AssistantTextResponse but no active assistant message found.");
            return prevMessages; // Return unchanged if no assistant message
        });
        return undefined; // Does not yield back to generator

      case 'AssistantMessageStart':
        // Add the initial assistant message shell to the messages list
        setMessages(prevMessages => [...prevMessages, coreEvent.message as MessageType]); // Add type assertion
        return undefined; // Does not yield back to generator
        
      case 'AssistantMessageEnd':
        // Update the final assistant message details (cost, duration, etc.)
        setMessages(prevMessages => {
          const msgIndex = prevMessages.findIndex(m => m.uuid === coreEvent.message.uuid);
          if (msgIndex !== -1) {
            const updatedMessages = [...prevMessages];
            updatedMessages[msgIndex] = coreEvent.message as MessageType; // Update with final details & assert type
            return updatedMessages;
          }
          logger.warn(`Could not find message ${coreEvent.message.uuid} to finalize.`);
          return prevMessages;
        });
        // Stop loading and clear controller as this ends the turn
        loggedSetIsLoading(false); 
        setAbortController(null);
        return undefined; // Does not yield back to generator

      case 'ProgressUpdate':
        // Update UI with progress status (e.g., show a spinner)
        logger.info(`Progress: ${coreEvent.status} ${coreEvent.message || ''} ${coreEvent.toolUseId || ''}`);
        // Potentially update a status indicator in the UI here
         if (coreEvent.status === 'thinking') {
           // You could set a specific 'thinking' state here
         } else if (coreEvent.status === 'tool_executing') {
           // Indicate which tool is running
         }
        return undefined; // Does not yield back to generator

      case 'ErrorOccurred':
        // Display error message to the user
        logger.error(`Core Error: ${coreEvent.message}`, coreEvent.error);
        const errorMsg = createAssistantAPIErrorMessage(coreEvent.message);
        setMessages(oldMessages => [...oldMessages, errorMsg]);
        // Stop loading and clear controller as this ends the turn
        loggedSetIsLoading(false); 
        setAbortController(null);
        // Potentially yield an error tool result if tied to a tool
        if (coreEvent.toolUseId) {
           return {
            type: 'tool_result',
            tool_use_id: coreEvent.toolUseId,
               content: `Error during tool processing: ${coreEvent.message}`,
            is_error: true,
          };
        }
        return undefined; // Or handle differently if not tool-related


      case 'ToolResultYielded':
        // The core has processed a result we sent back.
        // We should NOT add UI elements to the message state here.
        // Just log that the core acknowledged the result.
        logger.debug(`Core acknowledged ToolResult for: ${coreEvent.toolUseId}`, coreEvent.result);
        return undefined; // Does not yield back to generator


      case 'ToolRequested':
        logger.debug(`Tool Requested: ${coreEvent.toolName} with ID: ${coreEvent.toolUseId}`);
        let toolResult: ToolResultBlockParam | undefined = undefined;
        let toolToUse: Tool | null = null;

        try {
          // Get the tool - ScriptaCore already handled permissions before yielding this event
          toolToUse = getToolOrThrow(coreEvent.toolName);
          logger.debug(`Executing tool: ${toolToUse.name} (Permission already granted by Core)`);
          // Use logged setter
          loggedSetIsLoading(true); // Show loading while tool executes

          // Construct ToolUseContext required by tool.call
          const lastMessage = messages[messages.length - 1];
          const messageUuid = lastMessage?.uuid ?? 'unknown-message-uuid'; // Provide a fallback

          const toolUseContext: ToolUseContext = { // Match the type from Tool.ts
              uuid: coreEvent.toolUseId, // Use the ID from the event
              messageUuid: messageUuid,
              cwd: getCwd(), // Get current working directory
              abortSignal: abortController.signal, // Pass the abort signal, matching the interface
              // Add readFileTimestamps for file validation tools
              readFileTimestamps: readFileTimestamps.current, 
              options: {
                  dangerouslySkipPermissions: dangerouslySkipPermissions,
                  forkNumber: forkNumber, 
                  messageLogName: messageLogName,
                  tools: tools
              },
          };

          try {
              // Execute the tool using tool.call
              const output = await toolToUse.call(coreEvent.toolInput, toolUseContext); 

              // --- Process Tool Output --- 
              let finalResult: any = null;
              let resultForAssistant: string | null = null;

              if (typeof output === 'object' && output !== null && typeof (output as any)[Symbol.asyncIterator] === 'function') {
                  // ... (generator handling) ...
                  logger.debug(`Tool ${toolToUse.name} returned an async generator.`);
                  const generator = output as AsyncGenerator<any, any, any>;
                  let lastYieldedValue: any = null;

                  while (true) {
                      const { value, done } = await generator.next();
                      if (done) {
                          finalResult = value;
                          logger.debug(`Tool generator finished, final result:`, finalResult);
                          break;
                      } else {
                          lastYieldedValue = value;
                          logger.debug(`Tool yielded value:`, value);
                          if (typeof value === 'object' && value !== null) {
                              if (value.resultForAssistant) {
                                  resultForAssistant = value.resultForAssistant;
                              }
                          }
                      }
                  }
                  if (finalResult === undefined && lastYieldedValue !== null) {
                      finalResult = lastYieldedValue;
                      logger.debug(`Generator returned undefined, using last yielded value as final result.`);
                  }
                  if (typeof finalResult === 'object' && finalResult !== null && finalResult.resultForAssistant) {
                    resultForAssistant = finalResult.resultForAssistant;
                  }
              } else {
                  // ... (direct return handling) ...
                  logger.debug(`Tool ${toolToUse.name} returned directly:`, output);
                  finalResult = output;
                  if (typeof finalResult === 'object' && finalResult !== null && finalResult.resultForAssistant) {
                      resultForAssistant = finalResult.resultForAssistant;
                  }
              }

              // --- Construct ToolResultBlockParam --- 
               toolResult = {
                 type: 'tool_result',
                 tool_use_id: coreEvent.toolUseId,
                 content: [{
                      type: 'text',
                      text: resultForAssistant ?? (typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult ?? 'Tool executed successfully.', null, 2))
                  }], 
                  is_error: false
              };
              
              // Attach the raw output data for potential UI rendering later
              (toolResult as any).rawOutputData = finalResult; 

          } catch (error: any) {
               // ... (existing error handling for tool execution) ...
               logger.error(`Error executing tool ${coreEvent.toolName}:`, error);
               let errorMessage = `Error executing tool: ${coreEvent.toolName}.`;
               if (error instanceof Error) {
                 errorMessage += ` ${error.message}`;
               }
                toolResult = {
                  type: 'tool_result',
                  tool_use_id: coreEvent.toolUseId,
                  content: [{ type: 'text', text: errorMessage }],
                  is_error: true
                };
          } finally {
               // Use logged setter
               loggedSetIsLoading(false);
          }
        
        // This top-level catch handles errors finding the tool itself
        } catch (error: any) {
          logger.error(`Error finding or preparing tool ${coreEvent.toolName}:`, error);
          let errorMessage = `Error setting up tool: ${coreEvent.toolName}.`;
            if (error instanceof Error) {
              errorMessage += ` ${error.message}`;
            }
            toolResult = {
              type: 'tool_result',
              tool_use_id: coreEvent.toolUseId,
              content: [{ type: 'text', text: errorMessage }],
              is_error: true
            };
            // Also ensure loading stops if tool setup fails
            loggedSetIsLoading(false);
        }

        // Log and return result
        // ... (existing logging) ...
         logger.debug(`Sending result for ${coreEvent.toolUseId} back to core:`, {
          type: toolResult?.type,
          tool_use_id: toolResult?.tool_use_id,
          is_error: toolResult?.is_error,
          contentSize: typeof toolResult?.content === 'string' ? 
             `${Math.min(toolResult.content.length, 100)} chars` +
             (toolResult.content.length > 100 ? '...' : '') : (toolResult?.content ? 'object/array' : 'null/undefined')
        });
        return toolResult;

      default:
        // Log unhandled event types using type assertion for exhaustive check simulation
        // Ensure logger.warn receives only one string argument
        const eventType = (coreEvent as any)?.type ?? 'unknown';
        logger.warn(`Received unhandled CoreEvent type: ${eventType}`); 
        return undefined;
    }
  }, [tools, permissionHandler, dangerouslySkipPermissions, forkNumber, messageLogName, messages, setMessages, conditionalLog, sessionManager]);

  async function onQuery(
    newMessages: MessageType[],
    abortController: AbortController,
  ) {
    // Update messages state with new messages
    setMessages(oldMessages => [...oldMessages, ...newMessages]);
    
    // Trigger sync after messages are updated
    setShouldSyncMessages(true);
    
    // Add a small delay to ensure React state has propagated
    await new Promise(resolve => setTimeout(resolve, 10));
    
    markProjectOnboardingComplete()
    
    const lastMessage = newMessages[newMessages.length - 1]!
    // Check if lastMessage is UserMessage before accessing .message
    const userInput = 
      lastMessage?.type === 'user' && typeof lastMessage.message.content === 'string' 
      ? lastMessage.message.content 
      : ""; // Default to empty string if not a user text message

    if (lastMessage.type === 'assistant') {
      // Handle cases where input processing already yielded an assistant message (e.g., bash cd)
      setAbortController(null)
      setIsLoading(false)
      return
    }
    if (userInput === "") {
        // Handle cases where the input wasn't a user text message (e.g. tool result, progress)
        logger.warn(`onQuery called without user text input.`);
        setIsLoading(false);
        setAbortController(null);
        return;
    }

    // Use logged setter
    loggedSetIsLoading(true);

    try {
      // Define a constant session ID for the CLI
      const sessionId = 'cli-session';
      
      // Add additional logging to debug message state
      logger.debug(`Current React state messages count: ${messages.length}`);
      
      // Verify session state before starting
      const sessionState = await sessionManager.getSessionState(sessionId);
      logger.debug(`Starting core engine with ${sessionState.messages.length} messages in session state`);
      
      // Print a few messages from the session state to verify content
      if (sessionState.messages.length > 0) {
        const lastStateMsg = sessionState.messages[sessionState.messages.length - 1];
        const firstStateMsg = sessionState.messages[0];
        logger.debug(`First session message: ${firstStateMsg.type}, Last session message: ${lastStateMsg.type}`);
      }
      
      // Check for duplicate user messages to avoid adding them again
      const isDuplicateUserMessage = lastMessage.type === 'user' && 
        sessionState.messages.some(m => 
          m.type === 'user' && 
          typeof m.message.content === 'string' &&
          typeof lastMessage.message.content === 'string' &&
          m.message.content === lastMessage.message.content
        );

      if (!isDuplicateUserMessage) {
        // Only add the latest user message to the session to avoid duplicates
        logger.debug('Adding new user message to session');
        await sessionManager.setMessages(sessionId, [...sessionState.messages, lastMessage]);
        
        // Double-check that message was added
        const updatedState = await sessionManager.getSessionState(sessionId);
        logger.debug(`After adding message: session has ${updatedState.messages.length} messages`);
      } else {
        logger.debug('Skipping duplicate user message');
      }

      // Call processInput with sessionId and sessionManager
      coreEngineRef.current = processInput(
          userInput,
          sessionId,
          sessionManager,
          permissionHandler,
          abortController.signal
      );

      let nextToolResult: ToolResultBlockParam | undefined = undefined;
      while (true) {
          if (!coreEngineRef.current) break; // Guard against null ref
          const { value: coreEvent, done } = await coreEngineRef.current.next(nextToolResult);
          nextToolResult = undefined;

          if (done) {
              logger.debug(`Core engine processing finished.`);
              break;
          }

          if (coreEvent) {
              nextToolResult = await handleCoreEvent(coreEvent, abortController);
          } else {
               logger.debug(`Received undefined event from core generator.`);
          }
      }

    } catch (error) {
        logger.error(`Unhandled error during core processing:`, error);
        const errorMsg = createAssistantAPIErrorMessage("An unexpected error occurred.");
        setMessages(oldMessages => [...oldMessages, errorMsg]);
    } finally {
        // REMOVE loading/controller reset from here - handled within event handlers
        // setIsLoading(false);
        // setAbortController(null); // Clear abort controller when done
        coreEngineRef.current = null; // Clear the generator ref
    }
  }

  // Register cost summary tracker
  useCostSummary()

  // Record transcripts locally, for debugging and conversation recovery
  useLogMessages(messages, messageLogName, forkNumber)

  // Log startup time
  useLogStartupTime()

  // Initial load
  useEffect(() => {
    onInit()
    // TODO: fix this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const normalizedMessages = useMemo(
    () => normalizeMessages(messages).filter(isNotEmptyMessage),
    [messages],
  )

  const unresolvedToolUseIDs = useMemo(
    () => getUnresolvedToolUseIDs(normalizedMessages),
    [normalizedMessages],
  )

  const inProgressToolUseIDs = useMemo(
    () => getInProgressToolUseIDs(normalizedMessages),
    [normalizedMessages],
  )

  const erroredToolUseIDs = useMemo(
    () =>
      new Set(
        getErroredToolUseMessages(normalizedMessages).map(
          _ => (_.message.content[0]! as ToolUseBlockParam).id,
        ),
      ),
    [normalizedMessages],
  )

  // Ensure messagesJSX is correctly formed before use
  const messagesJSX = useMemo(() => {
    const currentMcpClients = mcpClientState ?? [];
    const currentIsDefaultModel = isDefaultModelState ?? true;
    const currentNormalizedMessages = normalizedMessages || [];

    const staticPart = [
      {
        type: 'static' as const,
        jsx: (
          <Box flexDirection="column" key={`logo${forkNumber}`}>
            <Logo mcpClients={currentMcpClients} isDefaultModel={currentIsDefaultModel} />
            <ProjectOnboarding workspaceDir={getOriginalCwd()} />
          </Box>
        ),
      },
      ...reorderMessages(currentNormalizedMessages).map(_ => {
        const toolUseID = getToolUseID(_)
        
        // Removed the check for _.type === 'progress' as they are filtered out by the outer normalizeMessages hook
        // Default rendering is now using the Message component
        const message = (
            <Message
              message={_}
              messages={currentNormalizedMessages}
              addMargin={true}
              tools={tools}
              verbose={verbose}
              debug={debug}
              erroredToolUseIDs={erroredToolUseIDs ?? new Set()}
              inProgressToolUseIDs={inProgressToolUseIDs ?? new Set()}
              shouldAnimate={
                !toolJSX &&
                !toolUseConfirm &&
                !isMessageSelectorVisible &&
                (!toolUseID || (inProgressToolUseIDs ?? new Set()).has(toolUseID))
              }
              shouldShowDot={true}
              unresolvedToolUseIDs={unresolvedToolUseIDs ?? new Set()}
            />
        );

        // Determine if static or transient 
        // Pass the already normalized message list from the outer scope
        const type = shouldRenderStatically(
          _,
          currentNormalizedMessages,
          unresolvedToolUseIDs ?? new Set(),
        )
          ? 'static'
          : 'transient';

        if (debug) {
          return {
            type,
            jsx: (
              <Box
                borderStyle="single"
                borderColor={type === 'static' ? 'green' : 'red'}
                key={_.uuid}
                width="100%"
              >
                {message}
              </Box>
            ),
          }
        }

        return {
          type,
          jsx: (
            <Box key={_.uuid} width="100%">
              {message}
            </Box>
          ),
        }
      }),
    ];
    return staticPart;
  }, [
    // Keep full dependencies - use the memoized normalizedMessages
    forkNumber, normalizedMessages, tools, verbose, debug, erroredToolUseIDs, 
    inProgressToolUseIDs, toolJSX, toolUseConfirm, isMessageSelectorVisible, 
    unresolvedToolUseIDs, mcpClientState, isDefaultModelState
  ]);

  // only show the dialog once not loading
  const showingCostDialog = !isLoading && showCostDialog

  // Remove fallback `|| []` - messagesJSX should now always be an array
  const staticMessagesJSX = useMemo(() => messagesJSX.filter(_ => _.type === 'static').map(item => item.jsx), [messagesJSX]);
  const transientMessagesJSX = useMemo(() => messagesJSX.filter(_ => _.type === 'transient').map(item => item.jsx), [messagesJSX]);

  // Log state right before render
  logger.debug(`[REPL Render] State before render: isLoading=${isLoading}, toolUseConfirm=${!!toolUseConfirm}`);

  return (
      <Box flexDirection="column" flexGrow={1}>
        {/* Use the render prop function and suppress potential type error */}
        {/* @ts-ignore - Linter seems incorrect about Static prop types here */}
        <Static items={staticMessagesJSX}>
            {(jsxItem, index) => <Box key={index}>{jsxItem}</Box>}
        </Static>
        {/* Only render transient messages, not all messages */}
        {transientMessagesJSX.map((jsx, index) => <Box key={(jsx as any)?.key ?? index}>{jsx}</Box>)}
        
        <Box
          borderColor="red"
          borderStyle={debug ? 'single' : undefined}
          flexDirection="column"
          width="100%"
        >
          {/* Show a single spinner when loading */}
          {isLoading && !toolJSX && !toolUseConfirm && !binaryFeedbackContext && (
            <Spinner />
          )}
          {toolJSX ? toolJSX.jsx : null}
          {!toolJSX &&
            toolUseConfirm &&
            !isMessageSelectorVisible &&
            !binaryFeedbackContext &&
            showingCostDialog && (
              <CostThresholdDialog
                onDone={() => {
                  setShowCostDialog(false)
                  setHaveShownCostDialog(true)
                  const projectConfig = configService.getGlobalConfig()
                  configService.saveGlobalConfig({
                    ...projectConfig,
                    hasAcknowledgedCostThreshold: true,
                  })
                  logEvent('tengu_cost_threshold_acknowledged', {})
                }}
              />
          )}

          {/* Render ToolUseConfirm component (which is actually PermissionRequest) when its state is set */}
          { toolUseConfirm && (
              <ToolUseConfirmComponent 
                toolUseConfirm={toolUseConfirm} // Pass the state object as a prop
                onDone={() => loggedSetToolUseConfirm(null)} // Clear state when done
                verbose={verbose} // Pass verbose prop
              />
          )}

          {/* Conditionally render PromptInput, hiding if toolUseConfirm is active */}
          {!toolUseConfirm && 
            !toolJSX?.shouldHidePromptInput &&
            shouldShowPromptInput &&
            !isMessageSelectorVisible &&
            !binaryFeedbackContext &&
            !showingCostDialog && (
              <Box flexDirection="column">
                  <PromptInput
                      commands={commands}
                      forkNumber={forkNumber}
                      messageLogName={messageLogName}
                      tools={tools}
                      // Only disable based on loading state now, as it's hidden during prompts
                      isDisabled={isLoading} 
                      isLoading={isLoading}
                      onQuery={onQuery}
                      debug={debug}
                      verbose={verbose}
                      messages={messages}
                      setToolJSX={setToolJSX}
                      onAutoUpdaterResult={setAutoUpdaterResult}
                      autoUpdaterResult={autoUpdaterResult}
                      input={inputValue}
                      onInputChange={setInputValue}
                      mode={inputMode}
                      onModeChange={setInputMode}
                      submitCount={submitCount}
                      onSubmitCountChange={setSubmitCount}
                      setIsLoading={setIsLoading}
                      setAbortController={setAbortController}
                      onShowMessageSelector={() =>
                        setIsMessageSelectorVisible(prev => !prev)
                      }
                      setForkConvoWithMessagesOnTheNextRender={
                        setForkConvoWithMessagesOnTheNextRender
                      }
                      readFileTimestamps={readFileTimestamps.current}
                  />
              </Box>
          )}
        </Box>
        {isMessageSelectorVisible && (
          <MessageSelector
            erroredToolUseIDs={erroredToolUseIDs}
            unresolvedToolUseIDs={unresolvedToolUseIDs}
            messages={normalizeMessagesForAPI(messages)}
            onSelect={async message => {
              setIsMessageSelectorVisible(false)

              // If the user selected the current prompt, do nothing
              if (!messages.includes(message)) {
                return
              }

              // Cancel tool use calls/requests
              onCancel()

              // Hack: make sure the "Interrupted by user" message is
              // rendered in response to the cancellation. Otherwise,
              // the screen will be cleared but there will remain a
              // vestigial "Interrupted by user" message at the top.
              setImmediate(async () => {
                // Clear messages, and re-render
                await clearTerminal()
                setMessages([])
                setForkConvoWithMessagesOnTheNextRender(
                  messages.slice(0, messages.indexOf(message)),
                )

                // Populate/reset the prompt input
                if (typeof message.message.content === 'string') {
                  setInputValue(message.message.content)
                }
              })
            }}
            onEscape={() => setIsMessageSelectorVisible(false)}
            tools={tools}
          />
        )}
        {/** Fix occasional rendering artifact */}
        <Newline />
      </Box>
  )
}

function shouldRenderStatically(
  message: UserMessage | AssistantMessage,
  messages: (UserMessage | AssistantMessage)[],
  unresolvedToolUseIDs: Set<string>,
): boolean {
  switch (message.type) {
    case 'user':
    case 'assistant': {
      const toolUseID = getToolUseID(message)
      if (!toolUseID) {
        return true
      }
      if (unresolvedToolUseIDs.has(toolUseID)) {
        return false
      }

      // Progress messages are filtered out, so we can't check for corresponding progress message
      // Simplification: If the tool use is resolved (not in unresolvedToolUseIDs), render statically.
      return true; 
    }
  }
}

function intersects<A>(a: Set<A>, b: Set<A>): boolean {
  return a.size > 0 && b.size > 0 && [...a].some(_ => b.has(_))
}
