/**
 * Common provider error message constants
 * Used across the application for consistent error handling
 */

// General provider error prefix
export const API_ERROR_MESSAGE_PREFIX = 'Provider error';

// Specific error messages
export const CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE = 'Credit balance too low error';
export const INVALID_API_KEY_ERROR_MESSAGE = 'Invalid API key';
export const PROMPT_TOO_LONG_ERROR_MESSAGE = 'Prompt too long';
export const NO_CONTENT_MESSAGE = '[No content]';

/**
 * Format system prompt with context
 * Common utility used by multiple providers
 */
export function formatSystemPromptWithContext(
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