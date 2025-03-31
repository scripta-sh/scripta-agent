import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { getGlobalConfig, getProviderApiKey } from '../../utils/config';
import OpenAI from 'openai';
import { createComponentLogger } from '../../utils/log';

// Create a logger for this component
const logger = createComponentLogger('OpenAIProvider');

/**
 * Implementation of OpenAI API provider
 */
export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor() {
    super('openai');
  }

  /**
   * Get the base URL for the OpenAI API
   */
  protected getBaseURL(modelType: 'large' | 'small'): string {
    const config = getGlobalConfig();
    // Use the configured base URL or fall back to default
    return modelType === 'large' 
      ? config.largeModelBaseURL || 'https://api.openai.com/v1' 
      : config.smallModelBaseURL || 'https://api.openai.com/v1';
  }

  /**
   * Get the API key for OpenAI
   */
  protected getApiKey(modelType: 'large' | 'small'): string {
    return getProviderApiKey('openai', modelType) || '';
  }

  /**
   * Get default model names for OpenAI
   */
  protected getDefaultModel(modelType: 'large' | 'small'): string {
    const config = getGlobalConfig();
    
    if (modelType === 'large') {
      return config.largeModelName || 'gpt-4-turbo';
    } else {
      return config.smallModelName || 'gpt-3.5-turbo';
    }
  }

  /**
   * Apply OpenAI-specific configuration
   */
  protected async processConfig(opts: OpenAI.ChatCompletionCreateParams): Promise<OpenAI.ChatCompletionCreateParams> {
    // OpenAI supports using JSON response format for more reliable parsing
    if (opts.tools && opts.tools.length > 0) {
      // When using tools, set response_format to ensure better behavior
      opts.response_format = { type: "json_object" };
    }
    
    return opts;
  }

  /**
   * Process the response from OpenAI API
   */
  protected processResponse(response: OpenAI.ChatCompletion): OpenAI.ChatCompletion {
    // OpenAI responses don't need special processing
    return response;
  }
}