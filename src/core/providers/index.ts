import { ProviderRegistry } from './ProviderRegistry';
import { ProviderService } from './ProviderService';
import { createComponentLogger } from '../../utils/log';
import { AnthropicProvider } from './AnthropicProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { DeepSeekProvider } from './DeepSeekProvider';
import { MistralProvider } from './MistralProvider';
import { getGlobalConfig } from '../../utils/config';

// Create a logger for this component
const logger = createComponentLogger('ProviderInitialization');

/**
 * Initialize the provider system
 * This should be called at application startup
 */
export async function initializeProviders(): Promise<void> {
  logger.debug('Initializing provider system...');
  
  // Get the registry instance
  const registry = ProviderRegistry.getInstance();
  
  // Register built-in providers
  registry.registerProvider('anthropic', new AnthropicProvider());
  registry.registerProvider('openai', new OpenAIProvider());
  registry.registerProvider('deepseek', new DeepSeekProvider());
  registry.registerProvider('mistral', new MistralProvider());
  
  // Log the available providers
  logger.debug('Provider system initialized with providers:', registry.getRegisteredProviders());
  
  // Log the current provider from config
  const config = getGlobalConfig();
  logger.debug(`Current primary provider: ${config.primaryProvider || 'anthropic'}`);
}

// Don't initialize providers on module load
// Instead, we'll initialize them when explicitly called
// This avoids the "Config accessed before allowed" error

/**
 * Export the main provider service entry point
 * This is what should be used throughout the application to interact with LLMs
 */
export const llmService = ProviderService.getInstance();

// Import and re-export error constants from central location
import { API_ERROR_MESSAGE_PREFIX } from '../constants/providerErrors';
export { API_ERROR_MESSAGE_PREFIX };

// Export interfaces and classes for use in other modules
export * from './ILLMProvider';
export * from './BaseProvider';
export * from './OpenAICompatibleProvider';
export * from './ProviderRegistry';
export * from './ProviderFactory';
export * from './ProviderService';
export * from './MessageConversion';
export * from './AnthropicProvider';
export * from './OpenAIProvider';
export * from './DeepSeekProvider';
export * from './MistralProvider';