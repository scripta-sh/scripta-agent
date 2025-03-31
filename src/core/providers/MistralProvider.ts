import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { getGlobalConfig, getProviderApiKey } from '../../utils/config';
import OpenAI from 'openai';
import { createComponentLogger } from '../../utils/log';

// Create a logger for this component
const logger = createComponentLogger('MistralProvider');

/**
 * Implementation of Mistral API provider
 */
export class MistralProvider extends OpenAICompatibleProvider {
  constructor() {
    super('mistral');
  }

  /**
   * Get the base URL for the Mistral API
   */
  protected getBaseURL(modelType: 'large' | 'small'): string {
    const config = getGlobalConfig();
    // Use the configured base URL or fall back to default
    return modelType === 'large' 
      ? config.largeModelBaseURL || 'https://api.mistral.ai/v1' 
      : config.smallModelBaseURL || 'https://api.mistral.ai/v1';
  }

  /**
   * Get the API key for Mistral
   */
  protected getApiKey(modelType: 'large' | 'small'): string {
    return getProviderApiKey('mistral', modelType) || '';
  }

  /**
   * Get default model names for Mistral
   */
  protected getDefaultModel(modelType: 'large' | 'small'): string {
    const config = getGlobalConfig();
    
    if (modelType === 'large') {
      return config.largeModelName || 'mistral-large-latest';
    } else {
      return config.smallModelName || 'mistral-small-latest';
    }
  }

  /**
   * Apply Mistral-specific configuration
   */
  protected async processConfig(opts: OpenAI.ChatCompletionCreateParams): Promise<OpenAI.ChatCompletionCreateParams> {
    // Ensure safe_prompt is false to avoid safety filtering that might impact tool use
    (opts as any).safe_prompt = false;
    
    // Mistral might have issues with certain message formats
    if (opts.messages) {
      opts.messages = opts.messages.map(msg => {
        // Fix complex content structures that Mistral might not handle well
        if (typeof msg.content !== 'string' && Array.isArray(msg.content)) {
          // For complex message content, convert to string when possible
          const stringContent = msg.content
            .filter(item => item.type === 'text')
            .map(item => (item as any).text)
            .join('\n\n');
          
          if (stringContent) {
            return { ...msg, content: stringContent };
          }
        }
        return msg;
      });
    }
    
    return opts;
  }

  /**
   * Process the response from Mistral API
   */
  protected processResponse(response: OpenAI.ChatCompletion): OpenAI.ChatCompletion {
    // Check if we need to add tool_calls array
    if (response.choices && 
        response.choices[0] && 
        response.choices[0].message && 
        !response.choices[0].message.tool_calls &&
        response.choices[0].message.content) {
      
      // Mistral might return function calls in the content as JSON string
      try {
        const content = response.choices[0].message.content;
        if (content && content.includes('"function":') && content.includes('"name":') && content.includes('"arguments":')) {
          // Try to parse potential JSON function calls
          // This handles the case where Mistral returns function calls in content instead of tool_calls
          const extractedJson = content.match(/\{[\s\S]*\}/)?.[0];
          if (extractedJson) {
            const parsed = JSON.parse(extractedJson);
            if (parsed.function && parsed.function.name && parsed.function.arguments) {
              // Create synthetic tool_calls
              response.choices[0].message.tool_calls = [{
                id: `mistral-${Date.now()}`,
                type: 'function',
                function: {
                  name: parsed.function.name,
                  arguments: parsed.function.arguments
                }
              }];
            }
          }
        }
      } catch (err) {
        logger.debug('Failed to parse potential function call from Mistral response', err);
      }
    }
    
    return response;
  }
}