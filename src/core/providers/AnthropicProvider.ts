import { BaseProvider } from './BaseProvider.js';
import { LLMProviderOptions } from './ILLMProvider.js';
import { Tool } from '../tools/interfaces/Tool.js';
import { UserMessage, AssistantMessage } from '../agent/types.js';
import { AbortSignal } from 'node-abort-controller';
import { createComponentLogger } from '../../shared/logging/log.js';
import { randomUUID } from 'crypto';
import { getProviderApiKey } from '../../shared/config/index.js';
import { normalizeContentFromAPI } from '../../shared/messages.js';
import Anthropic, { APIError } from '@anthropic-ai/sdk';
import { addToTotalCost } from '../../cost-tracker.js';
import { splitSysPromptPrefix, getCLISyspromptPrefix } from '../constants/prompts.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { createHash } from 'crypto';
import { logEvent } from '../../services/statsig.js';
import { withVCR } from '../../services/vcr.js';

// Create a logger for this component
const logger = createComponentLogger('AnthropicProvider');

// Cost constants
const SONNET_COST_PER_MILLION_INPUT_TOKENS = 3;
const SONNET_COST_PER_MILLION_OUTPUT_TOKENS = 15;
const SONNET_COST_PER_MILLION_PROMPT_CACHE_WRITE_TOKENS = 3.75;
const SONNET_COST_PER_MILLION_PROMPT_CACHE_READ_TOKENS = 0.3;

/**
 * Implementation of Anthropic Claude as a provider
 */
export class AnthropicProvider extends BaseProvider {
  private client: Anthropic | null = null;
  private PROMPT_CACHING_ENABLED = !process.env.DISABLE_PROMPT_CACHING;
  
  constructor() {
    super('anthropic');
  }
  
  /**
   * Get the Anthropic client, creating it if it doesn't exist
   */
  private getClient(model?: string, customApiKey?: string): Anthropic {
    if (this.client) {
      return this.client;
    }
    
    const apiKey = customApiKey || getProviderApiKey('anthropic');
    if (!apiKey) {
      logger.error('No Anthropic API key configured');
      throw new Error('No Anthropic API key configured');
    }
    
    this.client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
    });
    
    return this.client;
  }
  
  /**
   * Reset the client to force recreation
   */
  private resetClient(): void {
    this.client = null;
  }
  
  /**
   * Query the Anthropic Claude model
   */
  public async query(
    messages: (UserMessage | AssistantMessage)[],
    systemPrompt: string[],
    maxTokens: number,
    tools: Tool[],
    signal: AbortSignal,
    options: LLMProviderOptions
  ): Promise<AssistantMessage> {
    return await withVCR(messages, () => this.queryWithPromptCaching(
      messages, 
      systemPrompt, 
      maxTokens, 
      tools, 
      signal, 
      options
    ));
  }
  
  /**
   * Main implementation of Claude query with prompt caching
   */
  private async queryWithPromptCaching(
    messages: (UserMessage | AssistantMessage)[],
    systemPrompt: string[],
    maxTokens: number,
    tools: Tool[],
    signal: AbortSignal,
    options: LLMProviderOptions
  ): Promise<AssistantMessage> {
    // Reset client to get a fresh one
    this.resetClient();
    
    // Get client with potentially custom API key
    const anthropic = this.getClient(options.model as string, options.apiKey as string);
    const startIncludingRetries = Date.now();
    
    try {
      // Format messages for the API
      const messageParams = this.addCacheBreakpoints(messages);
      
      // Handle CLI system prompt prefix
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
      
      // Format the system prompt
      const systemPromptStr = systemPrompt.join('\n\n');
      
      // Convert tool schemas
      const toolSchemas = await Promise.all(
        tools.map(async tool => ({
          name: tool.name,
          description: typeof tool.description === 'function' 
            ? await tool.description({}) 
            : tool.description,
          input_schema: ('inputJSONSchema' in tool && tool.inputJSONSchema
            ? tool.inputJSONSchema
            : zodToJsonSchema(tool.inputSchema)),
        }))
      );
      
      // Call API with retry handling
      let response = await this.withRetry(async attempt => {
        const start = Date.now();
        logger.debug(`[Attempt ${attempt}] Calling Anthropic API with model ${options.model}`);
        
        const result = await anthropic.messages.create({
          model: options.model as string || 'claude-3-7-sonnet-20250219',
          messages: messageParams,
          system: systemPromptStr,
          max_tokens: maxTokens || 4000,
          temperature: 1.0,
          tools: toolSchemas.length > 0 ? toolSchemas : undefined,
          signal: signal
        });
        
        logger.debug(`API call completed in ${Date.now() - start}ms`);
        return result;
      });
      
      // Calculate response timing and token usage
      const durationMs = Date.now() - startIncludingRetries;
      
      const inputTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;
      const cacheReadInputTokens = response.usage?.cache_read_input_tokens ?? 0;
      const cacheCreationInputTokens = response.usage?.cache_creation_input_tokens ?? 0;
      
      // Calculate cost
      const costUSD =
        (inputTokens / 1_000_000) * SONNET_COST_PER_MILLION_INPUT_TOKENS +
        (outputTokens / 1_000_000) * SONNET_COST_PER_MILLION_OUTPUT_TOKENS +
        (cacheReadInputTokens / 1_000_000) *
          SONNET_COST_PER_MILLION_PROMPT_CACHE_READ_TOKENS +
        (cacheCreationInputTokens / 1_000_000) *
          SONNET_COST_PER_MILLION_PROMPT_CACHE_WRITE_TOKENS;
      
      // Track costs
      addToTotalCost(costUSD, durationMs);
      
      // Format and return the response
      const normalizedContent = normalizeContentFromAPI(response?.content);
      
      return {
        message: {
          id: response?.id || randomUUID(),
          model: response?.model || options.model as string || 'claude-3-7-sonnet-20250219',
          role: 'assistant',
          stop_reason: response?.stop_reason || 'stop_sequence',
          stop_sequence: response?.stop_sequence || '',
          type: 'message',
          content: normalizedContent,
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_read_input_tokens: cacheReadInputTokens,
            cache_creation_input_tokens: cacheCreationInputTokens
          },
        },
        costUSD,
        durationMs,
        type: 'assistant',
        uuid: randomUUID(),
      };
    } catch (error) {
      logger.error('Error calling Anthropic API:', error);
      return this.createErrorResponse(error as Error);
    }
  }
  
  /**
   * Verify that an API key is valid
   */
  public async verifyApiKey(apiKey: string): Promise<boolean> {
    try {
      const anthropic = new Anthropic({
        apiKey,
        dangerouslyAllowBrowser: true,
        maxRetries: 3,
      });
      
      await this.withRetry(
        async () => {
          await anthropic.messages.create({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'test' }],
            temperature: 0,
          });
          return true;
        },
        { maxRetries: 2 } // Use fewer retries for verification
      );
      
      return true;
    } catch (error) {
      logger.error('API key verification failed:', error);
      
      // Check specifically for authentication error
      if (
        error instanceof Error &&
        error.message.includes('invalid x-api-key')
      ) {
        return false;
      }
      
      // Other errors might not be API key related
      throw error;
    }
  }
  
  /**
   * Add cache breakpoints to messages
   */
  private addCacheBreakpoints(
    messages: (UserMessage | AssistantMessage)[],
  ): { role: string; content: any }[] {
    return messages.map((msg, index) => {
      if (msg.type === 'user') {
        return this.userMessageToMessageParam(msg, index > messages.length - 3);
      } else {
        return this.assistantMessageToMessageParam(msg, index > messages.length - 3);
      }
    });
  }
  
  /**
   * Convert user message to API parameter format
   */
  private userMessageToMessageParam(
    message: UserMessage,
    addCache = false,
  ): { role: string; content: any } {
    if (addCache) {
      if (typeof message.message.content === 'string') {
        return {
          role: 'user',
          content: [
            {
              type: 'text',
              text: message.message.content,
              ...(this.PROMPT_CACHING_ENABLED
                ? { cache_control: { type: 'ephemeral' } }
                : {}),
            },
          ],
        };
      } else {
        return {
          role: 'user',
          content: message.message.content.map((block, i) => ({
            ...block,
            ...(i === message.message.content.length - 1
              ? this.PROMPT_CACHING_ENABLED
                ? { cache_control: { type: 'ephemeral' } }
                : {}
              : {}),
          })),
        };
      }
    }
    
    return {
      role: 'user',
      content: message.message.content,
    };
  }
  
  /**
   * Convert assistant message to API parameter format
   */
  private assistantMessageToMessageParam(
    message: AssistantMessage,
    addCache = false,
  ): { role: string; content: any } {
    if (addCache) {
      if (typeof message.message.content === 'string') {
        return {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: message.message.content,
              ...(this.PROMPT_CACHING_ENABLED
                ? { cache_control: { type: 'ephemeral' } }
                : {}),
            },
          ],
        };
      } else {
        return {
          role: 'assistant',
          content: message.message.content.map((block, i) => ({
            ...block,
            ...(i === message.message.content.length - 1 &&
            block.type !== 'thinking' &&
            block.type !== 'redacted_thinking'
              ? this.PROMPT_CACHING_ENABLED
                ? { cache_control: { type: 'ephemeral' } }
                : {}
              : {}),
          })),
        };
      }
    }
    
    return {
      role: 'assistant',
      content: message.message.content,
    };
  }
}
