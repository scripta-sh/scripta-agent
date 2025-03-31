import { Tool } from '../../Tool';
import { UserMessage, AssistantMessage } from '../agent';
import { AbortSignal } from 'node-abort-controller';

/**
 * Interface for Language Model Providers
 * All LLM providers (Anthropic, OpenAI, etc.) should implement this interface
 */
export interface ILLMProvider {
  /**
   * Query the LLM to generate a response
   * 
   * @param messages The message history for context
   * @param systemPrompt System prompt parts to use
   * @param maxTokens Maximum tokens to generate
   * @param tools Tools available to the model
   * @param signal AbortSignal to cancel the request
   * @param options Provider-specific options
   * @returns AssistantMessage with the model's response
   */
  query(
    messages: (UserMessage | AssistantMessage)[],
    systemPrompt: string[],
    maxTokens: number,
    tools: Tool[],
    signal: AbortSignal,
    options: {
      model?: string;
      prependCLISysprompt?: boolean;
      [key: string]: any;
    }
  ): Promise<AssistantMessage>;

  /**
   * Verify that the API key for this provider is valid
   * 
   * @param apiKey API key to verify
   * @returns Promise resolving to true if valid, false otherwise
   */
  verifyApiKey(apiKey: string): Promise<boolean>;
}

/**
 * Base options for all LLM provider configs
 */
export interface LLMProviderOptions {
  model?: string;
  prependCLISysprompt?: boolean;
  [key: string]: any;
}