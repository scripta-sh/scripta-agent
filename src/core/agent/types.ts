/**
 * Core agent message and context types
 * Migrated from src/query.ts
 */

import { UUID } from 'crypto';
import { Tool } from '../tools/interfaces/Tool';
import { Message as APIAssistantMessage, MessageParam, ToolUseBlock, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { AbortController } from 'node-abort-controller';

/**
 * Basic response type
 */
export type Response = { costUSD: number; response: string };

/**
 * User message in the conversation
 */
export type UserMessage = {
  message: MessageParam;
  type: 'user';
  uuid: UUID;
  toolUseResult?: FullToolUseResult;
};

/**
 * Assistant (AI) message in the conversation
 */
export type AssistantMessage = {
  costUSD: number;
  durationMs: number;
  message: APIAssistantMessage;
  type: 'assistant';
  uuid: UUID;
  isApiErrorMessage?: boolean;
};

/**
 * Result from binary feedback comparison
 */
export type BinaryFeedbackResult =
  | { message: AssistantMessage | null; shouldSkipPermissionCheck: false }
  | { message: AssistantMessage; shouldSkipPermissionCheck: true };

/**
 * Progress message during tool execution
 */
export type ProgressMessage = {
  content: AssistantMessage;
  normalizedMessages: NormalizedMessage[];
  siblingToolUseIDs: Set<string>;
  tools: Tool[];
  toolUseID: string;
  type: 'progress';
  uuid: UUID;
};

/**
 * Represents the result of a tool execution, to be included in the message history.
 */
export type ToolResultMessage = {
  type: 'tool_result';
  message: ToolResultBlockParam;
  uuid: UUID; // Add UUID for consistency
};

/**
 * Union type for all message types in the conversation
 */
export type Message = UserMessage | AssistantMessage | ProgressMessage | ToolResultMessage;

/**
 * Full result of a tool use
 */
export type FullToolUseResult = {
  data?: any;
  resultForAssistant: string;
};

/**
 * Context for tool use operations
 */
export type ToolUseContext = {
  abortController: AbortController;
  options: {
    dangerouslySkipPermissions?: boolean;
    tools: Tool[];
    maxThinkingTokens?: number;
    slowAndCapableModel?: string;
    [key: string]: any;
  };
  readFileTimestamps: Record<string, number>;
};

/**
 * Normalized message for API calls
 */
export type NormalizedMessage = UserMessage | AssistantMessage;

/**
 * Maximum number of concurrent tool executions
 */
export const MAX_TOOL_USE_CONCURRENCY = 10;

/**
 * Events yielded by the ScriptaCore processInput generator to communicate
 * state changes, requests, and results to the driving interface (CLI/Server).
 */
export type CoreEvent =
  // Indicates textual output from the assistant (can be partial/streaming)
  | { type: 'AssistantTextResponse'; text: string; messageId?: string } // messageId helps correlate streaming chunks
  // Request for the driving layer to execute a tool
  | { type: 'ToolRequested'; toolUseId: string; toolName: string; toolInput: any }
  // Notification that the core has received and processed a tool result
  | { type: 'ToolResultYielded'; toolUseId: string; result: ToolResultBlockParam }
  // Signals an error occurred within the core processing
  | { type: 'ErrorOccurred'; message: string; error?: Error; toolUseId?: string } // toolUseId if error relates to a specific tool
  // Provides updates on background activity (e.g., LLM call in progress)
  | { type: 'ProgressUpdate'; status: 'thinking' | 'tool_executing' | 'idle'; message?: string; toolUseId?: string }
  // Signals the start of an assistant message turn
  | { type: 'AssistantMessageStart'; message: Message } // Provides the initial assistant message object
  // Signals the end of an assistant message turn, including final details
  | { type: 'AssistantMessageEnd'; message: Message }; // Provides the final assistant message object (with cost, duration, etc.)