import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { getGlobalConfig, getProviderApiKey } from '../../utils/config';
import OpenAI from 'openai';
import { createComponentLogger } from '../../utils/log';

// Create a logger for this component
const logger = createComponentLogger('DeepSeekProvider');

/**
 * Implementation of DeepSeek API provider
 */
export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor() {
    super('deepseek');
  }

  /**
   * Get the base URL for the DeepSeek API
   */
  protected getBaseURL(modelType: 'large' | 'small'): string {
    const config = getGlobalConfig();
    // Use the configured base URL or fall back to default
    return modelType === 'large' 
      ? config.largeModelBaseURL || 'https://api.deepseek.com/v1' 
      : config.smallModelBaseURL || 'https://api.deepseek.com/v1';
  }

  /**
   * Get the API key for DeepSeek
   */
  protected getApiKey(modelType: 'large' | 'small'): string {
    return getProviderApiKey('deepseek', modelType) || '';
  }

  /**
   * Get default model names for DeepSeek
   */
  protected getDefaultModel(modelType: 'large' | 'small'): string {
    const config = getGlobalConfig();
    
    if (modelType === 'large') {
      return config.largeModelName || 'deepseek-coder-33b-instruct';
    } else {
      return config.smallModelName || 'deepseek-coder-6.7b-instruct';
    }
  }

  /**
   * Apply DeepSeek-specific configuration
   */
  protected async processConfig(opts: OpenAI.ChatCompletionCreateParams): Promise<OpenAI.ChatCompletionCreateParams> {
    // DeepSeek models have specific configuration needs
    
    // Set reasoning effort for better tool use
    if (!opts.reasoning_effort && opts.tools && opts.tools.length > 0) {
      opts.reasoning_effort = 'high';
    }
    
    // Handle format compatibility issues
    if (opts.messages) {
      // DeepSeek might have issues with certain message formats
      opts.messages = opts.messages.map(msg => {
        // Handle tool messages with array content (convert to string)
        if (msg.role === 'tool' && Array.isArray(msg.content)) {
          return {
            ...msg,
            content: msg.content.map(c => 
              typeof c === 'object' && c.text ? c.text : String(c)
            ).join('\n\n')
          };
        }
        return msg;
      });
    }
    
    return opts;
  }

  /**
   * Process the response from DeepSeek API
   */
  protected processResponse(response: OpenAI.ChatCompletion): OpenAI.ChatCompletion {
    // DeepSeek has custom fields we need to handle
    
    // Check if we have reasoning_content in a non-standard location
    if (response.choices && 
        response.choices[0] && 
        response.choices[0].message && 
        !(response.choices[0].message as any).reasoning_content &&
        (response as any).reasoning_content) {
      
      // Move it to the message where our converter expects it
      (response.choices[0].message as any).reasoning_content = (response as any).reasoning_content;
    }
    
    return response;
  }
}