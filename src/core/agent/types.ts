/**
 * Core agent message and context types
 * Migrated from src/query.ts
 */

import { UUID } from 'crypto';
import { Tool } from '../../Tool';
import { Message as APIAssistantMessage, MessageParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs';
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
 * Union type for all message types in the conversation
 */
export type Message = UserMessage | AssistantMessage | ProgressMessage;

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