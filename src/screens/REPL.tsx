import { ToolUseBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { Box, Newline, Static, Text, useApp, useInput, useStdin } from 'ink'
import ProjectOnboarding, {
  markProjectOnboardingComplete,
} from '../ProjectOnboarding.js'
import { CostThresholdDialog } from '../components/CostThresholdDialog'
import * as React from 'react'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Command } from '../commands'
import { Logo } from '../components/Logo'
import { Message } from '../components/Message'
import { MessageResponse } from '../components/MessageResponse'
import { MessageSelector } from '../components/MessageSelector'
import {
  PermissionRequest,
  ToolUseConfirm,
} from '../components/permissions/PermissionRequest'
import PromptInput from '../components/PromptInput'
import { Spinner } from '../components/Spinner'
import { getSystemPrompt } from '../constants/prompts'
import { getContext } from '../context'
import { getTotalCost, useCostSummary } from '../cost-tracker'
import { useLogStartupTime } from '../hooks/useLogStartupTime'
import { addToHistory } from '../history'
import { useCancelRequest } from '../hooks/useCancelRequest'
import { useLogMessages } from '../hooks/useLogMessages'
import {
  type AssistantMessage,
  type BinaryFeedbackResult,
  type Message as MessageType,
  type ProgressMessage,
  query,
} from '../query'
import type { WrappedClient } from '../services/mcpClient'
import type { Tool } from '../Tool'
import { AutoUpdaterResult } from '../utils/autoUpdater'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config'
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
  type NormalizedMessage,
  normalizeMessages,
  normalizeMessagesForAPI,
  processUserInput,
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
import { getOriginalCwd } from '../utils/state'
import { getClients } from '../services/mcpClient.js'
import { processInput, SessionState, CoreEvent } from '../core/ScriptaCore'
import { IPermissionHandler, PermissionHandlerContext } from "../core/permissions/IPermissionHandler";
import { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { renderToolResultMessage } from '../cli/renderers/toolRenderers'

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
    request: PermissionRequest;
}

function PermissionPrompt({ request }: PermissionPromptProps) {
    const { exit } = useApp();
    const [selection, setSelection] = useState<'allow' | 'deny' | null>(null);

    useInput((input, key) => {
        if (selection) return; // Already decided

        if (input === 'y' || input === 'Y') {
            setSelection('allow');
            request.onAllow();
        } else if (input === 'n' || input === 'N') {
            setSelection('deny');
            request.onDeny();
        } else if (key.escape) {
            setSelection('deny'); // Treat escape as deny
            request.onDeny();
        }
    });

    return (
        <Box borderStyle="round" padding={1} flexDirection="column">
            <Text bold color="yellow">Tool Request:</Text>
            <Text>The assistant wants to use the tool: {request.toolName}</Text>
            <Newline />
            <Text>Allow? (y/n)</Text>
            {selection === 'allow' && <>{' '}<Text color="green">(Allowed)</Text></>}
            {selection === 'deny' && <>{' '}<Text color="red">(Denied)</Text></>}
        </Box>
    );
}

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
  // TODO: probably shouldn't re-read config from file synchronously on every keystroke
  const verbose = verboseFromCLI ?? getGlobalConfig().verbose
  
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
  const [toolJSX, setToolJSX] = useState<{
    jsx: React.ReactNode | null
    shouldHidePromptInput: boolean
  } | null>(null)
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
    getGlobalConfig().hasAcknowledgedCostThreshold,
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

  // Use local PermissionRequest type for state
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);

  // Define coreEngineRef at the top level
  const coreEngineRef = useRef<AsyncGenerator<CoreEvent, void, ToolResultBlockParam | undefined> | null>(null);

  // MCP State & related hooks... (ensure these are declared before use)
  // MCP State & related hooks... (ensure these are declared before use)

  // Instantiate the permission handler (Uses the original state setters)
  const permissionHandler = useMemo(() => new CliPermissionHandler(setToolUseConfirm, (req) => {
    console.log(`[REPL] Setting permission request:`, req?.tool ? req.tool.name : null);
    setPermissionRequest(req);
  }), [setToolUseConfirm, setPermissionRequest]);

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
         console.error("Failed to fetch data for Logo:", error);
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
    setIsLoading(false)
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
    // reverify()

    if (!initialPrompt) {
      return
    }

    setIsLoading(true)

    const abortController = new AbortController()
    setAbortController(abortController)

    const model = await getSlowAndCapableModel()
    const newMessages = await processUserInput(
      initialPrompt,
      'prompt',
      setToolJSX,
      {
        abortController,
        options: {
          // commands,
          // forkNumber,
          messageLogName,
          tools,
          // verbose,
          slowAndCapableModel: model,
          maxThinkingTokens: 0,
        },
        messageId: getLastAssistantMessageId(messages),
        setForkConvoWithMessagesOnTheNextRender,
        readFileTimestamps: readFileTimestamps.current,
      },
      null,
    )

    if (newMessages.length) {
      for (const message of newMessages) {
        if (message.type === 'user') {
          addToHistory(initialPrompt)
          // TODO: setHistoryIndex
        }
      }
      setMessages(_ => [..._, ...newMessages])

      // The last message is an assistant message if the user input was a bash command,
      // or if the user input was an invalid slash command.
      const lastMessage = newMessages[newMessages.length - 1]!
      if (lastMessage.type === 'assistant') {
        setAbortController(null)
        setIsLoading(false)
        return
      }

      // Commenting out the old query loop as it conflicts with the new processInput flow
      /*
        const [systemPrompt, context, model, maxThinkingTokens] =
          await Promise.all([
            getSystemPrompt(),
            getContext(),
            getSlowAndCapableModel(),
            getMaxThinkingTokens([...messages, ...newMessages]),
          ])

        for await (const message of query(
          [...messages, ...newMessages],
          systemPrompt,
          context,
          permissionHandler, // This handler might not be the correct type for the old query fn
          {
            options: {
              tools,
              slowAndCapableModel: model,
              dangerouslySkipPermissions,
              maxThinkingTokens,
            },
            readFileTimestamps: readFileTimestamps.current,
            abortController,
          },
        )) {
          setMessages(oldMessages => [...oldMessages, message])
        }
      */
    } else {
      addToHistory(initialPrompt)
      // TODO: setHistoryIndex
    }

    setHaveShownCostDialog(
      getGlobalConfig().hasAcknowledgedCostThreshold || false,
    )

    setIsLoading(false)
  }

  const handleCoreEvent = useCallback(async (coreEvent: CoreEvent, abortController: AbortController) => {
         switch (coreEvent.type) {
             case 'assistantResponse':
                 conditionalLog("[REPL] Received assistantResponse:", coreEvent.text);
                 const assistantMsg = createAssistantMessage(coreEvent.text);
                 setMessages(oldMessages => [...oldMessages, assistantMsg]);
                 return undefined; // No result to send back

             case 'error':
                 console.error("[REPL] Received error:", coreEvent.message, coreEvent.error);
                 const errorMsg = createAssistantAPIErrorMessage(coreEvent.message);
                 setMessages(oldMessages => [...oldMessages, errorMsg]);
                 return undefined; // No result to send back

             case 'toolRequest':
                 console.log(`[REPL] Received toolRequest: ${coreEvent.toolName}`, {
                    inputSize: typeof coreEvent.toolInput === 'string' ? 
                      `${Math.min(coreEvent.toolInput.length, 30)} chars` + 
                      (coreEvent.toolInput.length > 30 ? '...' : '') :
                      'object',
                    toolUseId: coreEvent.toolUseId // Log the tool use ID for tracing
                 });

                 // --- Actual Tool Execution Logic ---
                 let toolResult: ToolResultBlockParam | undefined = undefined;
                 const toolToUse = tools.find(t => t.name === coreEvent.toolName);

                 if (!toolToUse) {
                     // Construct result object directly
                     toolResult = {
                         type: 'tool_result',
                         tool_use_id: coreEvent.toolUseId,
                         content: `Error: Tool '${coreEvent.toolName}' not found. Available tools: ${tools.map(t => t.name).join(', ')}`,
                         is_error: true,
                     };
                 } else {
                     try {
                         // Clone the abort controller to prevent accidental aborts
                         const permissionContext: PermissionHandlerContext = { 
                            abortController: new AbortController(), 
                            options: { 
                                dangerouslySkipPermissions: dangerouslySkipPermissions ?? false
                            }
                         };
                         
                         // Add event listener to propagate aborts from main controller to permission context
                         abortController.signal.addEventListener('abort', () => {
                            permissionContext.abortController.abort('Main flow aborted');
                         });
                         let granted = false;

                         // 1. Check for existing permission first
                         console.log(`[REPL] Checking permission for ${toolToUse.name} (ID: ${coreEvent.toolUseId})`);
                         granted = await permissionHandler.checkPermission(toolToUse, coreEvent.toolInput, permissionContext);

                         // 2. If not granted, request it
                         if (!granted) {
                             console.log(`[REPL] No existing permission found. Requesting via handler for ${toolToUse.name} (ID: ${coreEvent.toolUseId})`);
                             // TODO: We need the assistantMessage that triggered this tool request
                             //       to pass to the requestPermission method.
                             //       For now, we might need a placeholder or to adjust the handler interface.
                             //       Let's assume we can get it from the message history for now (requires finding it).
                             const lastAssistantMessage = messages.slice().reverse().find(m => m.type === 'assistant') as AssistantMessage | undefined;
                             // We'll let the PermissionHandler handle null values now, so no need to throw an error
                             
                             granted = await permissionHandler.requestPermission(
                                 toolToUse,
                                 coreEvent.toolInput,
                                 permissionContext,
                                 lastAssistantMessage // Pass the found message, which might be undefined
                             );
                         }

                         if (granted) {
                             conditionalLog(`[REPL] Permission granted. Calling tool: ${coreEvent.toolName}`);
                             
                             // Add feedback message to UI confirming permission was granted
                             const permissionGrantedMsg = {
                                 type: 'assistant',
                                 message: {
                                     id: `permission-granted-${Date.now()}`,
                                     role: 'assistant',
                                     content: [{ 
                                         type: 'text', 
                                         text: `Permission granted for ${toolToUse.userFacingName?.(coreEvent.toolInput) || coreEvent.toolName}` 
                                     }]
                                 },
                                 // Ensure the dot shows by setting metadata needed for dot display
                                 isSuccessMessage: true,
                                 durationMs: 0,
                                 costUSD: 0
                             };
                             setMessages(oldMessages => [...oldMessages, permissionGrantedMsg]);
                             
                             const output = await toolToUse.call(
                                coreEvent.toolInput,
                                { 
                                   abortController,
                                   options: {
                                     dangerouslySkipPermissions: dangerouslySkipPermissions ?? false,
                                     forkNumber,
                                     messageLogName,
                                     verbose: false
                                   },
                                   readFileTimestamps: {}
                                }
                             );
                             conditionalLog(`[REPL] Tool ${coreEvent.toolName} finished. Raw Output Type:`, typeof output);

                             // Format the result - Handle AsyncGenerator specifically
                             let resultContent: string;
                             let toolResultObject: any = null; // For preserving object structure
                             
                             const isAsyncGenerator = (val: any): val is AsyncGenerator => {
                                return typeof val === 'object' && val !== null && typeof val[Symbol.asyncIterator] === 'function';
                             };

                             if (isAsyncGenerator(output)) {
                                // Just log that we're processing an AsyncGenerator without details
                                conditionalLog(`[REPL] Processing AsyncGenerator output for ${coreEvent.toolName}...`);
                                let accumulatedContent = "";
                                let resultObjects: any[] = [];
                                
                                try {
                                    for await (const value of output) {
                                        // Store original objects for LLM
                                        if (typeof value === 'object' && value !== null) {
                                            resultObjects.push(value);
                                        }
                                        
                                        // Format for display
                                        if (typeof value === 'object' && value !== null) {
                                            try {
                                                // For final results with type and data
                                                if (value.type === 'result' && value.data) {
                                                    const formattedResult = JSON.stringify(value.data, null, 2);
                                                    accumulatedContent += formattedResult;
                                                } else {
                                                    // Generic object serialization
                                                    accumulatedContent += JSON.stringify(value, null, 2);
                                                }
                                            } catch (e) {
                                                console.error(`[REPL] Error serializing tool output:`, e);
                                                accumulatedContent += `[Complex Object]`;
                                            }
                                        } else {
                                            // Append string values as before
                                            accumulatedContent += String(value);
                                        }
                                    }
                                    
                                    resultContent = accumulatedContent;
                                    
                                    // If we collected objects, use the last one (or all combined for some tools)
                                    if (resultObjects.length > 0) {
                                        if (resultObjects.length === 1) {
                                            toolResultObject = resultObjects[0];
                                        } else {
                                            // For tools that yield multiple objects, use the last with 'result' type if available
                                            const resultObj = resultObjects.find(obj => obj.type === 'result');
                                            if (resultObj) {
                                                toolResultObject = resultObj;
                                            } else {
                                                // Otherwise use the last object
                                                toolResultObject = resultObjects[resultObjects.length - 1];
                                            }
                                        }
                                    }
                                    
                                    // Use proper tool rendering instead of plain text
                                    // Create a user tool result message that will render properly
                                    const toolData = toolResultObject?.data || toolResultObject || { content: resultContent };
                                    
                                    // Create a message structure that will be properly rendered by the Message component
                                    const toolOutputMessage = {
                                        type: 'user',
                                        message: {
                                            id: `tool-output-${coreEvent.toolUseId}`,
                                            role: 'user',
                                            content: [
                                                {
                                                    type: 'tool_result',
                                                    tool_use_id: coreEvent.toolUseId,
                                                    content: resultContent,
                                                    name: coreEvent.toolName // Important: include the tool name
                                                }
                                            ]
                                        },
                                        // Add toolUseResult for UserToolSuccessMessage component
                                        toolUseResult: {
                                            data: toolData,
                                            tool_use_id: coreEvent.toolUseId
                                        }
                                    };
                                    
                                    // Debug log what's being rendered - but truncate long content
                                    conditionalLog(`[REPL] Tool output message for ${coreEvent.toolName}:`, {
                                        type: toolOutputMessage.type,
                                        id: toolOutputMessage.message.id,
                                        contentType: toolOutputMessage.message.content[0]?.type,
                                        // Only log brief info about content, not the full content
                                        contentSize: typeof resultContent === 'string' ? 
                                            `${resultContent.length} chars` : 'object'
                                    });
                                    
                                    // Add the properly structured message to be rendered
                                    setMessages(oldMessages => [...oldMessages, toolOutputMessage]);
                                    
                                    // Log brief summary instead of full content
                                    conditionalLog(`[REPL] Tool ${coreEvent.toolName} result summary:`, {
                                        size: typeof resultContent === 'string' ? resultContent.length : 'object',
                                        objectType: toolResultObject ? typeof toolResultObject : 'none'
                                    });
                                } catch (genError) {
                                     console.error(`[REPL] Error consuming generator for ${coreEvent.toolName}:`, genError);
                                     resultContent = `[Error consuming tool generator: ${genError instanceof Error ? genError.message : String(genError)}]`;
                                }
                             } else if (typeof output === 'string') {
                                 resultContent = output;
                             } else if (typeof output === 'object' && output !== null) {
                                 try {
                                     resultContent = JSON.stringify(output, null, 2);
                                     toolResultObject = output; // Save the original object
                                 } catch (e) {
                                     console.error(`[REPL] Error stringifying tool output for ${coreEvent.toolName}:`, e);
                                     resultContent = `[Error: Could not serialize tool output]`;
                                 }
                             } else {
                                 resultContent = String(output);
                             }

                             // Use resultForAssistant if available
                             const finalContent = toolResultObject?.resultForAssistant || resultContent;
                             
                             toolResult = {
                                type: 'tool_result',
                                tool_use_id: coreEvent.toolUseId,
                                content: finalContent,
                                // Include original data object for LLM if available
                                data: toolResultObject || undefined,
                                is_error: false
                             };

                         } else {
                             conditionalLog(`[REPL] Permission denied for tool: ${coreEvent.toolName}`);
                             
                             // Add feedback message for denying permission with an error dot
                             const permissionDeniedMsg = {
                                 type: 'assistant',
                                 message: {
                                     id: `permission-denied-${Date.now()}`,
                                     role: 'assistant',
                                     content: [{ 
                                         type: 'text', 
                                         text: `User rejected ${toolToUse.userFacingName?.(coreEvent.toolInput) || coreEvent.toolName}` 
                                     }]
                                 },
                                 // Ensure the red error dot shows
                                 isErrorMessage: true,
                                 durationMs: 0,
                                 costUSD: 0
                             };
                             setMessages(oldMessages => [...oldMessages, permissionDeniedMsg]);
                             
                             // Construct result object directly
                             toolResult = {
                                 type: 'tool_result',
                                 tool_use_id: coreEvent.toolUseId,
                                 content: `Permission denied by user for tool: ${coreEvent.toolName}`,
                                 is_error: true
                             };
                         }
                     } catch (error: any) {
                         console.error(`[REPL] Error executing tool ${coreEvent.toolName}:`, error);
                         let errorMessage = `Error executing tool: ${coreEvent.toolName}.`;
                         if (error instanceof Error) {
                            errorMessage += ` ${error.message}`;
                         }
                         // TODO: Potentially extract more specific error info
                         // Construct result object directly
                         toolResult = {
                             type: 'tool_result',
                             tool_use_id: coreEvent.toolUseId,
                             content: errorMessage, // Use the determined errorMessage
                             is_error: true
                         };
                     }
                 }
                 // --- End Actual Tool Execution Logic ---

                 conditionalLog(`[REPL] Sending result for ${coreEvent.toolUseId}:`, {
                    type: toolResult?.type,
                    tool_use_id: toolResult?.tool_use_id,
                    is_error: toolResult?.is_error,
                    contentSize: typeof toolResult?.content === 'string' ? 
                        `${Math.min(toolResult.content.length, 50)} chars` + 
                        (toolResult.content.length > 50 ? '...' : '') : 'object',
                    hasData: toolResult?.data ? 'yes' : 'no'
                 });
                 return toolResult; // Send the actual result (or error) back

             default:
                 conditionalLog("[REPL] Received unknown CoreEvent type:", (coreEvent as any)?.type);
                 return undefined;
         }
     }, [tools, permissionHandler, dangerouslySkipPermissions, setMessages]); // Added dependencies

  async function onQuery(
    newMessages: MessageType[],
    abortController: AbortController,
  ) {
    setMessages(oldMessages => [...oldMessages, ...newMessages])
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
        console.warn("[REPL] onQuery called without user text input.");
        setIsLoading(false);
        setAbortController(null);
        return;
    }

    setIsLoading(true);

    try {
      const currentSessionState: SessionState = {
        messages: [...messages, ...newMessages], // Pass current messages
        currentWorkingDirectory: getOriginalCwd(), // Get current CWD
        tools: tools, // Pass tools from props
        config: {
           dangerouslySkipPermissions: dangerouslySkipPermissions ?? false,
           // maxThinkingTokens: await getMaxThinkingTokens(...), // TODO: Get max tokens if needed by core
           // slowAndCapableModel: await getSlowAndCapableModel(), // TODO: Get model if needed by core
           // primaryProvider: getGlobalConfig().primaryProvider, // TODO: Get provider if needed
        }
      };

      // Call processInput WITHOUT abortController argument
      coreEngineRef.current = processInput(userInput, currentSessionState);

      let nextToolResult: ToolResultBlockParam | undefined = undefined;
      while (true) {
          if (!coreEngineRef.current) break; // Guard against null ref
          const { value: coreEvent, done } = await coreEngineRef.current.next(nextToolResult);
          nextToolResult = undefined;

          if (done) {
              conditionalLog("[REPL] Core engine processing finished.");
              break;
          }

          if (coreEvent) {
              nextToolResult = await handleCoreEvent(coreEvent, abortController);
          } else {
               conditionalLog("[REPL] Received undefined event from core generator.");
          }
      }

    } catch (error) {
        console.error("[REPL] Unhandled error during core processing:", error);
        const errorMsg = createAssistantAPIErrorMessage("An unexpected error occurred.");
        setMessages(oldMessages => [...oldMessages, errorMsg]);
    } finally {
        setIsLoading(false);
        setAbortController(null); // Clear abort controller when done
        coreEngineRef.current = null; // Clear the generator ref
    }
  }

  // Register cost summary tracker
  useCostSummary()

  // Register messages getter and setter
  // useEffect(() => {
  //   const getMessages = () => messages
  //   setMessagesGetter(getMessages)
  //   setMessagesSetter(setMessages)
  // }, [messages])

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
        const message =
          _.type === 'progress' ? (
            _.content.message.content[0]?.type === 'text' &&
            _.content.message.content[0].text === INTERRUPT_MESSAGE ? (
              <Message
                message={_.content}
                messages={_.normalizedMessages}
                addMargin={false}
                tools={_.tools}
                verbose={verbose ?? false}
                debug={debug}
                erroredToolUseIDs={new Set()}
                inProgressToolUseIDs={new Set()}
                unresolvedToolUseIDs={new Set()}
                shouldAnimate={false}
                shouldShowDot={false}
              />
            ) : (
              <MessageResponse children={ 
                <Message
                  message={_.content}
                  messages={_.normalizedMessages}
                  addMargin={false}
                  tools={_.tools}
                  verbose={verbose ?? false}
                  debug={debug}
                  erroredToolUseIDs={new Set()}
                  inProgressToolUseIDs={new Set()}
                  unresolvedToolUseIDs={
                    new Set([
                      (_.content.message.content[0]! as ToolUseBlockParam).id,
                    ])
                  }
                  shouldAnimate={false}
                  shouldShowDot={false}
                />
              } />
            )
          ) : (
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
    // Keep full dependencies
    forkNumber, normalizedMessages, tools, verbose, debug, erroredToolUseIDs, 
    inProgressToolUseIDs, toolJSX, toolUseConfirm, isMessageSelectorVisible, 
    unresolvedToolUseIDs, mcpClientState, isDefaultModelState
  ]);

  // only show the dialog once not loading
  const showingCostDialog = !isLoading && showCostDialog

  // Remove fallback `|| []` - messagesJSX should now always be an array
  const staticMessagesJSX = useMemo(() => messagesJSX.filter(_ => _.type === 'static').map(item => item.jsx), [messagesJSX]);
  const transientMessagesJSX = useMemo(() => messagesJSX.filter(_ => _.type === 'transient').map(item => item.jsx), [messagesJSX]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Use the render prop function and suppress potential type error */}
      {/* @ts-ignore - Linter seems incorrect about Static prop types here */}
      <Static items={staticMessagesJSX}>
          {(jsxItem, index) => <Box key={index}>{jsxItem}</Box>}
      </Static>
      {/* Map over transient messages */} 
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
          !binaryFeedbackContext && (
            <PermissionRequest
              toolUseConfirm={toolUseConfirm}
              onDone={() => setToolUseConfirm(null)}
              verbose={verbose ?? false}
            />
          )}
        {!toolJSX &&
          !toolUseConfirm &&
          !isMessageSelectorVisible &&
          !binaryFeedbackContext &&
          showingCostDialog && (
            <CostThresholdDialog
              onDone={() => {
                setShowCostDialog(false)
                setHaveShownCostDialog(true)
                const projectConfig = getGlobalConfig()
                saveGlobalConfig({
                  ...projectConfig,
                  hasAcknowledgedCostThreshold: true,
                })
                logEvent('tengu_cost_threshold_acknowledged', {})
              }}
            />
          )}

        {/* Conditionally render PermissionPrompt */} 
        {permissionRequest && (
            <PermissionPrompt request={permissionRequest} />
        )}

        {/* Conditionally render PromptInput, disabling if permissionRequest is active */}
        <Box flexDirection="column">
            {!toolUseConfirm &&
              !toolJSX?.shouldHidePromptInput &&
              shouldShowPromptInput &&
              !isMessageSelectorVisible &&
              !binaryFeedbackContext &&
              !showingCostDialog && (
              <PromptInput
                  commands={commands}
                  forkNumber={forkNumber}
                  messageLogName={messageLogName}
                  tools={tools}
                  isDisabled={isLoading || !!permissionRequest} // Disable input during loading OR permission request
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
          )}
        </Box>
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
  message: NormalizedMessage,
  messages: NormalizedMessage[],
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

      const correspondingProgressMessage = messages.find(
        _ => _.type === 'progress' && _.toolUseID === toolUseID,
      ) as ProgressMessage | null
      if (!correspondingProgressMessage) {
        return true
      }

      return !intersects(
        unresolvedToolUseIDs,
        correspondingProgressMessage.siblingToolUseIDs,
      )
    }
    case 'progress':
      return !intersects(unresolvedToolUseIDs, message.siblingToolUseIDs)
  }
}

function intersects<A>(a: Set<A>, b: Set<A>): boolean {
  return a.size > 0 && b.size > 0 && [...a].some(_ => b.has(_))
}
