/**
 * Core tool types
 */

import { AbortController } from 'node-abort-controller';
import { Tool } from './interfaces/Tool';

/**
 * Context for tool use operations
 * Moved from core/agent/types.ts
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