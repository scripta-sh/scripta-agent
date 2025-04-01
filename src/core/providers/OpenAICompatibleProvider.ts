import { BaseProvider } from './BaseProvider';
import { LLMProviderOptions } from './ILLMProvider';
import { Tool } from '../../Tool';
import { UserMessage, AssistantMessage } from '../../query';
import { AbortSignal } from 'node-abort-controller';
import { createComponentLogger } from '../../utils/log';
import { randomUUID } from 'crypto';
import { getGlobalConfig, getActiveApiKey, markApiKeyAsFailed, getApiKeys } from '../../utils/config';
import { convertAnthropicToOpenAI, convertOpenAIToAnthropic } from './MessageConversion';
import OpenAI from 'openai';
import { logEvent } from '../../services/statsig';
import { getSessionState, setSessionState } from '../../utils/sessionState';
import { splitSysPromptPrefix, getCLISyspromptPrefix } from '../constants/prompts';
import { createHash } from 'crypto';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ProxyAgent, fetch, Response } from 'undici';

// Create a logger for this component
const logger = createComponentLogger('OpenAICompatibleProvider');

/**
 * Error types that might occur with OpenAI-compatible providers
 */
enum ModelErrorType {
  MaxLength = '1024',
  MaxCompletionTokens = 'max_completion_tokens',
  StreamOptions = 'stream_options',
  Citations = 'citations',
  RateLimit = 'rate_limit'
}

/**
 * A base class for providers that implement the OpenAI-compatible API
 */
export abstract class OpenAICompatibleProvider extends BaseProvider {
  /**
   * Get the base URL for the API
   */
  protected abstract getBaseURL(modelType: 'large' | 'small'): string;
  
  /**
   * Get the API key for this provider
   */
  protected abstract getApiKey(modelType: 'large' | 'small'): string;
  
  /**
   * Get a model name appropriate for this provider
   */
  protected abstract getDefaultModel(modelType: 'large' | 'small'): string;
  
  /**
   * Process provider-specific configuration before sending
   */
  protected abstract processConfig(opts: OpenAI.ChatCompletionCreateParams): Promise<OpenAI.ChatCompletionCreateParams>;
  
  /**
   * Handle provider-specific response processing
   */
  protected abstract processResponse(response: OpenAI.ChatCompletion): OpenAI.ChatCompletion;
  
  /**
   * Query the model through the OpenAI-compatible API
   */
  public async query(
    messages: (UserMessage | AssistantMessage)[],
    systemPrompt: string[],
    maxTokens: number,
    tools: Tool[],
    signal: AbortSignal,
    options: LLMProviderOptions
  ): Promise<AssistantMessage> {
    const modelType = maxTokens > 4000 ? 'large' : 'small';
    const config = getGlobalConfig();
    
    // Handle CLI system prompt prefix for consistency with Anthropic
    if (options.prependCLISysprompt) {
      const [firstSyspromptBlock] = splitSysPromptPrefix(systemPrompt);
      logEvent('tengu_sysprompt_block', {
        snippet: firstSyspromptBlock?.slice(0, 20),
        length: String(firstSyspromptBlock?.length ?? 0),
        hash: firstSyspromptBlock
          ? createHash('sha256').update(firstSyspromptBlock).digest('hex')
          : '',
      });
      systemPrompt = [getCLISyspromptPrefix(), ...systemPrompt];
    }
    
    // Convert system prompt to OpenAI format
    const systemMessages = systemPrompt.map(content => ({
      role: 'system', 
      content
    } as OpenAI.ChatCompletionSystemMessageParam));
    
    // Convert Anthropic-style messages to OpenAI format
    const openAIMessages = convertAnthropicToOpenAI(messages);
    
    // Convert tools to OpenAI format
    const toolSchemas = await Promise.all(
      tools.map(async tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: await tool.prompt({
            dangerouslySkipPermissions: false,
          }),
          parameters: ('inputJSONSchema' in tool && tool.inputJSONSchema
            ? tool.inputJSONSchema
            : zodToJsonSchema(tool.inputSchema)),
        }
      }) as OpenAI.ChatCompletionTool)
    );
    
    // Prepare params for the API call
    let opts: OpenAI.ChatCompletionCreateParams = {
      model: options.model as string || this.getDefaultModel(modelType),
      messages: [...systemMessages, ...openAIMessages],
      max_tokens: maxTokens,
      temperature: 1.0, // Consistent with Anthropic
    };
    
    // Add tools if provided
    if (toolSchemas.length > 0) {
      opts.tools = toolSchemas;
      opts.tool_choice = 'auto';
    }
    
    // Apply provider-specific configuration
    opts = await this.processConfig(opts);
    
    // Set a reasonable timeout
    const timeoutMs = 120000; // 2 minutes
    const startTime = Date.now();
    
    try {
      // Call the API with retry logic
      const response = await this.getCompletionWithRetry(modelType, opts, signal);
      const durationMs = Date.now() - startTime;
      
      // Handle provider-specific response processing
      const processedResponse = this.processResponse(response);
      
      // Convert the response back to Anthropic format
      const anthropicResponse = convertOpenAIToAnthropic(processedResponse);
      
      // Create the final assistant message
      return {
        message: {
          id: processedResponse.id || randomUUID(),
          model: processedResponse.model || options.model as string,
          role: 'assistant',
          content: anthropicResponse.content,
          stop_reason: anthropicResponse.stop_reason,
          stop_sequence: '',
          type: 'message',
          usage: {
            input_tokens: processedResponse.usage?.prompt_tokens || 0,
            output_tokens: processedResponse.usage?.completion_tokens || 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0
          },
        },
        costUSD: 0, // Cost calculation would be provider-specific
        durationMs,
        type: 'assistant',
        uuid: randomUUID(),
      };
    } catch (error) {
      logger.error(`Error querying ${this.name} API:`, error);
      return this.createErrorResponse(error as Error);
    }
  }
  
  /**
   * Get completion with retry logic
   */
  private async getCompletionWithRetry(
    modelType: 'large' | 'small',
    opts: OpenAI.ChatCompletionCreateParams,
    signal: AbortSignal,
    attempt: number = 0,
    maxAttempts: number = 5
  ): Promise<OpenAI.ChatCompletion> {
    const config = getGlobalConfig();
    
    // Check for too many attempts
    if (attempt >= maxAttempts) {
      throw new Error(`Max retry attempts (${maxAttempts}) reached for ${this.name}`);
    }
    
    // Get API key
    const apiKey = this.getApiKey(modelType);
    if (!apiKey) {
      throw new Error(`No API key configured for ${this.name}`);
    }
    
    // Get base URL
    const baseURL = this.getBaseURL(modelType);
    if (!baseURL) {
      throw new Error(`No base URL configured for ${this.name}`);
    }
    
    // Apply model-specific error fixes
    await this.applyModelErrorFixes(opts, baseURL);
    
    // Make a deep copy to avoid mutation issues
    const requestOpts = structuredClone(opts);
    
    // Setup proxy if configured
    const proxy = config.proxy ? new ProxyAgent(config.proxy) : undefined;
    
    try {
      // Log API call (keep this one)
      logger.debug(`Calling ${this.name} API (${modelType}): ${baseURL}/chat/completions, model: ${requestOpts.model}`);
      
      // Make the API call
      const response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestOpts),
        dispatcher: proxy,
        signal,
      });
      
      // Handle response
      if (!response.ok) {
        const error = await response.json() as { error?: { message: string }, message?: string };
        return this.handleApiError(response, error, modelType, requestOpts, attempt, maxAttempts);
      }
      
      // Parse successful response
      const data = await response.json() as OpenAI.ChatCompletion;
      return data;
    } catch (error) {
      // Handle network errors
      logger.error(`Network error with ${this.name} API:`, error);
      
      // Exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempt), 32000);
      logger.warn(`Retrying in ${delay/1000}s (attempt ${attempt+1}/${maxAttempts})...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Retry
      return this.getCompletionWithRetry(modelType, opts, signal, attempt + 1, maxAttempts);
    }
  }
  
  /**
   * Handle API errors with appropriate recovery
   */
  private async handleApiError(
    response: Response,
    error: any,
    modelType: 'large' | 'small',
    opts: OpenAI.ChatCompletionCreateParams,
    attempt: number,
    maxAttempts: number
  ): Promise<OpenAI.ChatCompletion> {
    const errorMsg = error.error?.message || error.message || JSON.stringify(error);
    logger.error(`${this.name} API error:`, errorMsg);
    
    // Check for authentication errors
    const isAuthError = 
      response.status === 401 || 
      response.status === 403 || 
      errorMsg.toLowerCase().includes('authentication') ||
      errorMsg.toLowerCase().includes('api key');
    
    if (isAuthError) {
      throw new Error(`Authentication error with ${this.name} API: ${errorMsg}`);
    }
    
    // Check for rate limiting
    const isRateLimit = 
      response.status === 429 || 
      errorMsg.toLowerCase().includes('rate limit') || 
      errorMsg.toLowerCase().includes('too many requests');
    
    if (isRateLimit) {
      const retryAfter = response.headers.get('retry-after');
      const delay = retryAfter && !isNaN(parseInt(retryAfter)) 
        ? parseInt(retryAfter) * 1000 
        : Math.min(1000 * Math.pow(2, attempt), 32000);
      
      logger.warn(`Rate limited by ${this.name} API. Retrying in ${delay/1000}s (attempt ${attempt+1}/${maxAttempts})...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      return this.getCompletionWithRetry(modelType, opts, new AbortController().signal, attempt + 1, maxAttempts);
    }
    
    // Check for known error types and try to fix them
    const baseURL = this.getBaseURL(modelType);
    
    // Handle max length error
    if (errorMsg.includes('maximum length 1024')) {
      this.setModelError(baseURL, opts.model, ModelErrorType.MaxLength, errorMsg);
      
      // Fix by truncating tool descriptions
      for (const tool of opts.tools || []) {
        if (tool.function.description.length > 1024) {
          const truncated = tool.function.description.substring(0, 1000) + '...';
          tool.function.description = truncated;
        }
      }
      
      logger.warn(`Fixed MaxLength error. Retrying with truncated descriptions.`);
      return this.getCompletionWithRetry(modelType, opts, new AbortController().signal, attempt + 1, maxAttempts);
    }
    
    // Handle max_completion_tokens error
    if (errorMsg.includes('max_completion_tokens')) {
      this.setModelError(baseURL, opts.model, ModelErrorType.MaxCompletionTokens, errorMsg);
      
      // Fix by using max_completion_tokens instead of max_tokens
      opts.max_completion_tokens = opts.max_tokens;
      delete opts.max_tokens;
      
      logger.warn(`Fixed MaxCompletionTokens error. Retrying with max_completion_tokens.`);
      return this.getCompletionWithRetry(modelType, opts, new AbortController().signal, attempt + 1, maxAttempts);
    }
    
    // Handle stream_options error
    if (errorMsg.includes('stream_options')) {
      this.setModelError(baseURL, opts.model, ModelErrorType.StreamOptions, errorMsg);
      
      // Fix by removing stream_options
      delete opts.stream_options;
      
      logger.warn(`Fixed StreamOptions error. Retrying without stream_options.`);
      return this.getCompletionWithRetry(modelType, opts, new AbortController().signal, attempt + 1, maxAttempts);
    }
    
    // For other errors, just retry with exponential backoff
    if (attempt < maxAttempts - 1) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 32000);
      logger.warn(`Unknown error. Retrying in ${delay/1000}s (attempt ${attempt+1}/${maxAttempts})...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      return this.getCompletionWithRetry(modelType, opts, new AbortController().signal, attempt + 1, maxAttempts);
    }
    
    // If we've exhausted retries, throw the error
    throw new Error(`${this.name} API error after ${maxAttempts} attempts: ${errorMsg}`);
  }
  
  /**
   * Apply previously identified model error fixes
   */
  private async applyModelErrorFixes(
    opts: OpenAI.ChatCompletionCreateParams, 
    baseURL: string
  ): Promise<void> {
    if (this.hasModelError(baseURL, opts.model, ModelErrorType.MaxLength)) {
      for (const tool of opts.tools || []) {
        if (tool.function.description.length > 1024) {
          const truncated = tool.function.description.substring(0, 1000) + '...';
          tool.function.description = truncated;
        }
      }
    }
    
    if (this.hasModelError(baseURL, opts.model, ModelErrorType.MaxCompletionTokens)) {
      opts.max_completion_tokens = opts.max_tokens;
      delete opts.max_tokens;
    }
    
    if (this.hasModelError(baseURL, opts.model, ModelErrorType.StreamOptions)) {
      delete opts.stream_options;
    }
    
    if (this.hasModelError(baseURL, opts.model, ModelErrorType.Citations)) {
      // Remove citations from content objects
      if (opts.messages) {
        for (const msg of opts.messages) {
          if (Array.isArray(msg.content)) {
            for (const contentItem of msg.content) {
              // Check if it has the citations property and remove it
              if (contentItem && typeof contentItem === 'object' && 'citations' in (contentItem as any)) {
                delete (contentItem as any).citations;
              }
            }
          }
        }
      }
    }
  }
  
  /**
   * Check if a model error has been identified
   */
  private hasModelError(baseURL: string, model: string, type: ModelErrorType): boolean {
    const key = `${baseURL}:${model}:${type}`;
    return !!getSessionState('modelErrors')[key];
  }
  
  /**
   * Set a model error to remember fixes for future requests
   */
  private setModelError(baseURL: string, model: string, type: ModelErrorType, error: string): void {
    const key = `${baseURL}:${model}:${type}`;
    setSessionState('modelErrors', {
      [key]: error
    });
  }
  
  /**
   * Default verifyApiKey implementation for OpenAI-compatible providers
   */
  public async verifyApiKey(apiKey: string): Promise<boolean> {
    try {
      const modelType = 'small'; // Use small model for verification
      const baseURL = this.getBaseURL(modelType);
      
      const response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.getDefaultModel(modelType),
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1,
          temperature: 0,
        }),
      });
      
      return response.ok;
    } catch (error) {
      logger.error(`Error verifying API key for ${this.name}:`, error);
      return false;
    }
  }
}