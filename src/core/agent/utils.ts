/**
 * Agent utility functions
 * Migrated from src/query.ts
 */

import { BashTool } from '../tools/shell/BashTool/BashTool.js';
import type { Tool } from '../tools/types.js';
import { getCwd } from '../../shared/config/state.js';
import { UserMessage, AssistantMessage, BinaryFeedbackResult, ToolUseContext } from './types.js';
import { shouldUseBinaryFeedback, messagePairValidForBinaryFeedback } from '../../shared/binary-feedback/utils.js';

/**
 * Normalizes tool input based on tool type
 */
export function normalizeToolInput(
  tool: Tool,
  input: { [key: string]: boolean | string | number },
): { [key: string]: boolean | string | number } {
  switch (tool) {
    case BashTool: {
      const { command, timeout } = BashTool.inputSchema.parse(input); // already validated upstream, won't throw
      return {
        command: command.replace(`cd ${getCwd()} && `, ''),
        ...(timeout ? { timeout } : {}),
      };
    }
    default:
      return input;
  }
}

/**
 * Formats error messages from tools
 */
export function formatError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const parts = [error.message];
  if ('stderr' in error && typeof error.stderr === 'string') {
    parts.push(error.stderr);
  }
  if ('stdout' in error && typeof error.stdout === 'string') {
    parts.push(error.stdout);
  }
  const fullMessage = parts.filter(Boolean).join('\n');
  if (fullMessage.length <= 10000) {
    return fullMessage;
  }
  const halfLength = 5000;
  const start = fullMessage.slice(0, halfLength);
  const end = fullMessage.slice(-halfLength);
  return `${start}\n\n... [${fullMessage.length - 10000} characters truncated] ...\n\n${end}`;
}

/**
 * Handles binary feedback comparison for responses
 */
export async function queryWithBinaryFeedback(
  toolUseContext: ToolUseContext,
  getAssistantResponse: () => Promise<AssistantMessage>,
  getBinaryFeedbackResponse?: (
    m1: AssistantMessage,
    m2: AssistantMessage,
  ) => Promise<BinaryFeedbackResult>,
): Promise<BinaryFeedbackResult> {
  if (
    process.env.USER_TYPE !== 'ant' ||
    !getBinaryFeedbackResponse ||
    !(await shouldUseBinaryFeedback())
  ) {
    const assistantMessage = await getAssistantResponse();
    if (toolUseContext.abortController.signal.aborted) {
      return { message: null, shouldSkipPermissionCheck: false };
    }
    return { message: assistantMessage, shouldSkipPermissionCheck: false };
  }
  
  const [m1, m2] = await Promise.all([
    getAssistantResponse(),
    getAssistantResponse(),
  ]);
  
  if (toolUseContext.abortController.signal.aborted) {
    return { message: null, shouldSkipPermissionCheck: false };
  }
  
  if (m2.isApiErrorMessage) {
    // If m2 is an error, we might as well return m1, even if it's also an error --
    // the UI will display it as an error as it would in the non-feedback path.
    return { message: m1, shouldSkipPermissionCheck: false };
  }
  
  if (m1.isApiErrorMessage) {
    return { message: m2, shouldSkipPermissionCheck: false };
  }
  
  if (!messagePairValidForBinaryFeedback(m1, m2)) {
    return { message: m1, shouldSkipPermissionCheck: false };
  }
  
  return await getBinaryFeedbackResponse(m1, m2);
}
