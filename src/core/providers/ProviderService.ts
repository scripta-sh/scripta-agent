import { ILLMProvider, LLMProviderOptions } from './ILLMProvider';
import { ProviderFactory } from './ProviderFactory';
import { Tool } from '../../Tool';
import { UserMessage, AssistantMessage } from '../agent';
import { AbortSignal } from 'node-abort-controller';
import { createComponentLogger } from '../../utils/log';
import { getGlobalConfig } from '../../utils/config';

// Create a logger for this component
const logger = createComponentLogger('ProviderService');

/**
 * Main service for interacting with LLM providers
 * Acts as a facade over the provider implementation details
 */
export class ProviderService {
  private static instance: ProviderService;
  private factory: ProviderFactory;
  
  private constructor() {
    this.factory = ProviderFactory.getInstance();
  }
  
  /**
   * Get the singleton instance of the provider service
   */
  public static getInstance(): ProviderService {
    if (!ProviderService.instance) {
      ProviderService.instance = new ProviderService();
    }
    return ProviderService.instance;
  }
  
  /**
   * Query an LLM using the configured provider
   * 
   * @param messages Message history
   * @param systemPrompt System prompt parts
   * @param maxTokens Maximum tokens to generate
   * @param tools Available tools for the model
   * @param signal AbortSignal to cancel the request
   * @param options Additional options
   * @returns AssistantMessage with the model's response
   */
  public async query(
    messages: (UserMessage | AssistantMessage)[],
    systemPrompt: string[],
    maxTokens: number,
    tools: Tool[] = [],
    signal?: AbortSignal,
    options: LLMProviderOptions = {}
  ): Promise<AssistantMessage> {
    const config = getGlobalConfig();
    const providerId = config.primaryProvider || 'anthropic';
    
    try {
      const provider = this.factory.getProvider(providerId);
      logger.debug(`Using provider '${providerId}' for query`);
      
      return await provider.query(
        messages,
        systemPrompt,
        maxTokens,
        tools,
        signal || new AbortController().signal,
        {
          ...options,
          model: options.model || (maxTokens > 4000 ? config.largeModelName : config.smallModelName)
        }
      );
    } catch (error) {
      logger.error(`Error with provider '${providerId}', falling back to anthropic:`, error);
      
      try {
        // Try to fall back to Anthropic if the requested provider fails
        if (providerId !== 'anthropic') {
          const anthropicProvider = this.factory.getProvider('anthropic');
          return await anthropicProvider.query(
            messages,
            systemPrompt,
            maxTokens,
            tools,
            signal || new AbortController().signal,
            {
              ...options,
              model: options.model || (maxTokens > 4000 ? config.largeModelName : config.smallModelName)
            }
          );
        }
      } catch (fallbackError) {
        logger.error('Fallback to anthropic also failed:', fallbackError);
      }
      
      // If we get here, both the original provider and the fallback failed
      throw error;
    }
  }
  
  /**
   * Verify an API key with the specified provider
   * 
   * @param providerId Provider ID to check
   * @param apiKey API key to verify
   * @returns Promise resolving to true if valid, false otherwise
   */
  public async verifyApiKey(providerId: string, apiKey: string): Promise<boolean> {
    try {
      const provider = this.factory.getProvider(providerId);
      return await provider.verifyApiKey(apiKey);
    } catch (error) {
      logger.error(`Error verifying API key for provider '${providerId}':`, error);
      return false;
    }
  }
}