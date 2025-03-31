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
import { getSystemPrompt } from '../constants/prompts'
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
  // Removed "query" import - we're using ScriptaCore's processInput instead
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
  // Removed processUserInput - using ScriptaCore's processInput instead
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
import { processInput, CoreEvent } from '../core/ScriptaCore'
import { IPermissionHandler, PermissionHandlerContext } from "../core/permissions/IPermissionHandler";
import { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { renderToolResultMessage } from '../cli/renderers/toolRenderers'
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
    request: PermissionRequest;
}

function PermissionPrompt({ request }: PermissionPromptProps) {
    const { exit } = useApp();
    const [selection, setSelection] = useState<'allow' | 'deny' | null>(null);
    const { columns = 80 } = useTerminalSize();
    const theme = getTheme();

    // Add debug logging when component renders
    console.debug(`[PermissionPrompt] Rendering prompt for tool: ${request.toolName}`);

    useInput((input, key) => {
        if (selection) return; // Already decided

        if (input === 'y' || input === 'Y') {
            console.debug(`[PermissionPrompt] User selected ALLOW for ${request.toolName}`);
            setSelection('allow');
            request.onAllow();
        } else if (input === 'n' || input === 'N') {
            console.debug(`[PermissionPrompt] User selected DENY for ${request.toolName}`);
            setSelection('deny');
            request.onDeny();
        } else if (key.escape) {
            console.debug(`[PermissionPrompt] User pressed ESC to deny ${request.toolName}`);
            setSelection('deny'); // Treat escape as deny
            request.onDeny();
        }
    });

    // Render the tool input details based on tool type
    const renderToolInput = () => {
        switch (request.toolName) {
            case 'Bash':
                return (
                    <Box flexDirection="column" marginTop={1} paddingX={2}>
                        <Text color={theme.secondaryText}>Command:</Text>
                        <Box marginLeft={2} marginTop={1}>
                            <HighlightedCode
                                code={request.toolInput.command || ''}
                                language="bash"
                            />
                        </Box>
                    </Box>
                );
            case 'Edit': {
                const { file_path, old_string, new_string } = request.toolInput;
                const file = existsSync(file_path) ? readFileSync(file_path, 'utf8') : '';
                const patch = getPatch({
                    filePath: file_path,
                    fileContents: file,
                    oldStr: old_string,
                    newStr: new_string,
                });
                
                return (
                    <Box flexDirection="column">
                        <Box 
                            borderColor={theme.secondaryBorder}
                            borderStyle="round"
                            flexDirection="column"
                            paddingX={1}
                            marginY={1}
                        >
                            <Box paddingBottom={1}>
                                <Text bold>{relative(getCwd(), file_path)}</Text>
                            </Box>
                            {intersperse(
                                patch.map(p => (
                                    <StructuredDiff
                                        key={p.newStart}
                                        patch={p}
                                        dim={false}
                                        width={columns - 12}
                                    />
                                )),
                                i => (
                                    <Text color={theme.secondaryText} key={`ellipsis-${i}`}>
                                        ...
                                    </Text>
                                ),
                            )}
                        </Box>
                    </Box>
                );
            }
            case 'Replace': {
                const { file_path, content } = request.toolInput;
                const fileExists = existsSync(file_path);
                
                // If file exists, show diff
                if (fileExists) {
                    const oldContent = readFileSync(file_path, detectFileEncoding(file_path));
                    const hunks = getPatch({
                        filePath: file_path,
                        fileContents: oldContent.toString(),
                        oldStr: oldContent.toString(),
                        newStr: content,
                    });

                    return (
                        <Box flexDirection="column">
                            <Box 
                                borderColor={theme.secondaryBorder}
                                borderStyle="round"
                                flexDirection="column"
                                paddingX={1}
                                marginY={1}
                            >
                                <Box paddingBottom={1}>
                                    <Text bold>{relative(getCwd(), file_path)}</Text>
                                </Box>
                                {intersperse(
                                    hunks.map(p => (
                                        <StructuredDiff
                                            key={p.newStart}
                                            patch={p}
                                            dim={false}
                                            width={columns - 12}
                                        />
                                    )),
                                    i => (
                                        <Text color={theme.secondaryText} key={`ellipsis-${i}`}>
                                            ...
                                        </Text>
                                    ),
                                )}
                            </Box>
                        </Box>
                    );
                } else {
                    // If file doesn't exist, show new content
                    return (
                        <Box flexDirection="column">
                            <Box 
                                borderColor={theme.secondaryBorder}
                                borderStyle="round"
                                flexDirection="column"
                                paddingX={1}
                                marginY={1}
                            >
                                <Box paddingBottom={1}>
                                    <Text bold>{relative(getCwd(), file_path)}</Text>
                                </Box>
                                <HighlightedCode
                                    code={content || '(No content)'}
                                    language={extname(file_path).slice(1)}
                                />
                            </Box>
                        </Box>
                    );
                }
            }
            default:
                if (request.toolInput && Object.keys(request.toolInput).length > 0) {
                    // For other tools, show simplified input
                    return (
                        <Box marginTop={1} flexDirection="column">
                            <Box
                                borderColor={theme.secondaryBorder}
                                borderStyle="round"
                                flexDirection="column"
                                paddingX={1}
                                paddingY={1}
                            >
                                <HighlightedCode
                                    code={JSON.stringify(request.toolInput, null, 2)}
                                    language="json"
                                />
                            </Box>
                        </Box>
                    );
                }
                return null;
        }
    };

    // Set title based on tool type
    const getTitle = () => {
        switch (request.toolName) {
            case 'Bash':
                return "Bash command";
            case 'Edit':
                return "Edit file";
            case 'Replace':
                const fileExists = existsSync(request.toolInput.file_path);
                return fileExists ? "Edit file" : "Create file";
            default:
                return `Tool Request: ${request.toolName}`;
        }
    };

    // Get prompt text based on tool type
    const getPromptText = () => {
        switch (request.toolName) {
            case 'Edit':
            case 'Replace': {
                const { file_path } = request.toolInput;
                const fileExists = existsSync(file_path);
                return (
                    <Text>
                        Do you want to {fileExists ? 'make this edit to' : 'create'}{' '}
                        <Text bold>{basename(file_path)}</Text>?
                    </Text>
                );
            }
            case 'Bash':
                return <Text>Do you want to execute this command?</Text>;
            default:
                return <Text>Do you want to proceed?</Text>;
        }
    };

    return (
        <Box 
            borderStyle="round" 
            padding={1} 
            flexDirection="column"
            borderColor={theme.permission}
            marginTop={1}
        >
            <PermissionRequestTitle
                title={getTitle()}
                riskScore={null}
            />
            
            {renderToolInput()}
            
            <Box flexDirection="column" marginTop={1}>
                {getPromptText()}
                <Box marginTop={1}>
                    <Text>Allow? (y/n)</Text>
                    {selection === 'allow' && <>{' '}<Text color="green">(Allowed)</Text></>}
                    {selection === 'deny' && <>{' '}<Text color="red">(Denied)</Text></>}
                </Box>
            </Box>
        </Box>
    );
}

// Create a logger for this component
const logger = createComponentLogger('REPL');

// We need a helper function to format assistant responses in gray
// Add this near where the logger is defined
function logAssistantResponse(text: string, isDuplicate = false) {
  if (process.stdout?.isTTY) {
    const prefix = isDuplicate ? 
      chalk.gray('[REPL] Skipping duplicate assistant response:') : 
      chalk.gray('[REPL] Adding new assistant response:');
    
    // Format the preview text in gray, truncating if necessary
    const preview = text.substring(0, 50) + (text.length > 50 ? '...' : '');
    console.debug(chalk.gray(`${prefix} ${preview}`));
  } else {
    // In non-CLI mode, use the regular logger
    logger.debug(`${isDuplicate ? 'Skipping duplicate' : 'Adding new'} assistant response: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
  }
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
      // For tool use confirmation
      setToolUseConfirm, 
      // For simple permission requests
      (simplifiedRequest) => {
        if (simplifiedRequest) {
          // Use type assertion to avoid linter errors
          logger.debug(`Setting permission request: ${(simplifiedRequest as any).toolName || "unnamed tool"}`);
        } else {
          logger.debug(`Clearing permission request`);
        }
        setPermissionRequest(simplifiedRequest);
      }
    );
  }, [setToolUseConfirm, setPermissionRequest]);

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
        sessionManager
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
        getGlobalConfig().hasAcknowledgedCostThreshold || false,
      );
      
      setIsLoading(false);
      setAbortController(null);
    }
  }

  const handleCoreEvent = useCallback(async (coreEvent: CoreEvent, abortController: AbortController) => {
    switch (coreEvent.type) {
      case 'assistantResponse':
        logger.debug(`Received assistantResponse:`, coreEvent.text);
        
        // Check if this response is a duplicate of the last message
        const lastMessage = messages[messages.length - 1];
        const isDuplicate = lastMessage?.type === 'assistant' && 
            lastMessage?.message?.content[0]?.type === 'text' && 
            (lastMessage.message.content[0] as any).text === coreEvent.text;
            
        // Skip adding duplicate messages
        if (isDuplicate) {
          logAssistantResponse(coreEvent.text, true);
          return undefined;
        } else {
          logAssistantResponse(coreEvent.text, false);
        }
        
        // Create an assistant message from the text and add it to the messages state
        const assistantMsg = createAssistantMessage(coreEvent.text);
        setMessages(oldMessages => [...oldMessages, assistantMsg]);
        // Trigger sync after messages are updated
        setShouldSyncMessages(true);
        // Return undefined immediately, don't process this event further
        return undefined;

      case 'error':
        logger.error(`Received error: ${coreEvent.message}`, coreEvent.error);
        const errorMsg = createAssistantAPIErrorMessage(coreEvent.message);
        setMessages(oldMessages => [...oldMessages, errorMsg]);
        // Trigger sync after messages are updated
        setShouldSyncMessages(true);
        return undefined; // No result to send back

      case 'toolRequest':
        logger.debug(`Received toolRequest: ${coreEvent.toolName}`, {
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
            // Create the context required by the permission handler methods
            const permissionContext: PermissionHandlerContext = {
              abortController: abortController, // Use the controller for this query
              options: {
                dangerouslySkipPermissions: dangerouslySkipPermissions ?? false,
              }
            };
            
            // Add event listener to propagate aborts from main controller to permission context
            abortController.signal.addEventListener('abort', () => {
              permissionContext.abortController.abort('Main flow aborted');
            });
            
            // 1. Check for existing permission first
            logger.debug(`Checking permission for ${toolToUse.name} (ID: ${coreEvent.toolUseId})`);
            let granted = await permissionHandler.checkPermission(toolToUse, coreEvent.toolInput, permissionContext);

            // 2. If not granted, request it
            if (!granted) {
              logger.debug(`No existing permission found. Requesting via handler for ${toolToUse.name} (ID: ${coreEvent.toolUseId})`);
              const lastAssistantMessage = messages.slice().reverse().find(m => m.type === 'assistant') as AssistantMessage | undefined;
              
              granted = await permissionHandler.requestPermission(
                toolToUse,
                coreEvent.toolInput,
                permissionContext,
                lastAssistantMessage
              );
            }

            if (granted) {
              logger.debug(`Permission granted. Calling tool: ${coreEvent.toolName}`);
              
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
              logger.debug(`Tool ${coreEvent.toolName} finished. Raw Output Type:`, typeof output);

              // Handle generator output
              if (typeof output === 'object' && output !== null && typeof output[Symbol.asyncIterator] === 'function') {
                let finalResult = null;
                let resultForAssistant = null;
                
                for await (const value of output) {
                  if (value.type === 'result') {
                    finalResult = value.data;
                    resultForAssistant = value.resultForAssistant;
                  }
                }
                
                if (finalResult) {
                  // Create user message with tool result
                  const toolMessage = {
                    type: 'user',
                    message: {
                      id: `tool-result-${Date.now()}`,
                      role: 'user',
                      content: [
                        {
                          type: 'tool_result',
                          tool_use_id: coreEvent.toolUseId,
                          content: JSON.stringify(finalResult, null, 2)
                        }
                      ]
                    },
                    toolUseResult: {
                      data: finalResult,
                      tool_use_id: coreEvent.toolUseId
                    }
                  };
                  setMessages(oldMessages => [...oldMessages, toolMessage]);
                  
                  // Format for LLM
                  toolResult = {
                    type: 'tool_result',
                    tool_use_id: coreEvent.toolUseId,
                    content: resultForAssistant || JSON.stringify(finalResult, null, 2),
                    is_error: false
                  };
                }
              } else {
                // Handle non-generator response (string or other)
                const resultStr = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
                
                toolResult = {
                  type: 'tool_result',
                  tool_use_id: coreEvent.toolUseId,
                  content: resultStr,
                  is_error: false
                };
              }

            } else {
              logger.debug(`Permission denied for tool: ${coreEvent.toolName}`);
              
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
            logger.error(`Error executing tool ${coreEvent.toolName}:`, error);
            let errorMessage = `Error executing tool: ${coreEvent.toolName}.`;
            if (error instanceof Error) {
              errorMessage += ` ${error.message}`;
            }
            // Construct result object directly
            toolResult = {
              type: 'tool_result',
              tool_use_id: coreEvent.toolUseId,
              content: errorMessage,
              is_error: true
            };
          }
        }

        logger.debug(`Sending result for ${coreEvent.toolUseId}:`, {
          type: toolResult?.type,
          tool_use_id: toolResult?.tool_use_id,
          is_error: toolResult?.is_error,
          contentSize: typeof toolResult?.content === 'string' ? 
            `${Math.min(toolResult.content.length, 50)} chars` + 
            (toolResult.content.length > 50 ? '...' : '') : 'object'
        });
        return toolResult;

      default:
        logger.debug(`Received unknown CoreEvent type:`, (coreEvent as any)?.type);
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

    setIsLoading(true);

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
          sessionManager
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
        setIsLoading(false);
        setAbortController(null); // Clear abort controller when done
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
            <>
              {console.debug("[REPL] Rendering permission request for:", permissionRequest.toolName)}
              <PermissionPrompt request={permissionRequest} />
            </>
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
