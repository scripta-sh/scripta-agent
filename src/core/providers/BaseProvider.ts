import { ILLMProvider, LLMProviderOptions } from './ILLMProvider';
import { Tool } from '../../Tool';
import { UserMessage, AssistantMessage } from '../agent';
import { AbortSignal } from 'node-abort-controller';
import { createComponentLogger } from '../../utils/log';
import { logError } from '../../utils/log';
import { createAssistantAPIErrorMessage } from '../../utils/messages';

// Create a logger for this component
const logger = createComponentLogger('BaseProvider');

/**
 * Base abstract class for LLM providers
 * Implements common functionality and enforces the ILLMProvider interface
 */
export abstract class BaseProvider implements ILLMProvider {
  protected name: string;
  
  constructor(name: string) {
    this.name = name;
  }
  
  /**
   * Get the name of this provider
   */
  public getName(): string {
    return this.name;
  }
  
  /**
   * Each provider must implement the query method
   */
  public abstract query(
    messages: (UserMessage | AssistantMessage)[],
    systemPrompt: string[],
    maxTokens: number,
    tools: Tool[],
    signal: AbortSignal,
    options: LLMProviderOptions
  ): Promise<AssistantMessage>;
  
  /**
   * Each provider must implement verifyApiKey
   */
  public abstract verifyApiKey(apiKey: string): Promise<boolean>;
  
  /**
   * Format system prompt with context
   * Common utility used by multiple providers
   */
  protected formatSystemPromptWithContext(
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
  
  /**
   * Create a standardized error response as an AssistantMessage
   */
  protected createErrorResponse(error: Error | string): AssistantMessage {
    const errorMessage = typeof error === 'string' 
      ? error 
      : error.message || 'Unknown error';
      
    logError(`Provider ${this.name} error: ${errorMessage}`);
    
    return createAssistantAPIErrorMessage(`Provider error (${this.name}): ${errorMessage}`);
  }
  
  /**
   * Utility method to handle retries with exponential backoff
   */
  protected async withRetry<T>(
    operation: (attempt: number) => Promise<T>,
    options: { maxRetries?: number, baseDelayMs?: number } = {}
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 500;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await operation(attempt);
      } catch (error) {
        lastError = error;
        
        if (attempt > maxRetries) {
          throw error;
        }
        
        const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt - 1), 32000);
        logger.warn(`Provider ${this.name} API error, retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt}/${maxRetries})`);
        
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    throw lastError;
  }
}