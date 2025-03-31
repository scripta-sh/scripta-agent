import { ILLMProvider } from './ILLMProvider';
import { ProviderRegistry } from './ProviderRegistry';
import { createComponentLogger } from '../../utils/log';
import { getGlobalConfig } from '../../utils/config';

// Create a logger for this component
const logger = createComponentLogger('ProviderFactory');

/**
 * Factory class for creating and retrieving LLM providers
 */
export class ProviderFactory {
  private static instance: ProviderFactory;
  private registry: ProviderRegistry;
  
  private constructor() {
    this.registry = ProviderRegistry.getInstance();
  }
  
  /**
   * Get the singleton instance of the factory
   */
  public static getInstance(): ProviderFactory {
    if (!ProviderFactory.instance) {
      ProviderFactory.instance = new ProviderFactory();
    }
    return ProviderFactory.instance;
  }
  
  /**
   * Get a provider by ID, lazily initializing if needed
   * 
   * @param providerId ID of the provider to get
   * @returns The provider instance
   * @throws Error if the provider is not supported
   */
  public getProvider(providerId: string): ILLMProvider {
    // Check if we already have this provider registered
    if (this.registry.hasProvider(providerId)) {
      return this.registry.getProvider(providerId);
    }
    
    // Otherwise, we need to dynamically import the provider
    // This will be implemented when we create the individual provider classes
    logger.error(`Provider '${providerId}' not found and could not be loaded dynamically.`);
    throw new Error(`Provider '${providerId}' is not supported`);
  }
  
  /**
   * Get the currently configured default provider
   * 
   * @returns The default provider based on configuration
   */
  public getDefaultProvider(): ILLMProvider {
    const config = getGlobalConfig();
    const providerId = config.primaryProvider || 'anthropic';
    
    try {
      return this.getProvider(providerId);
    } catch (error) {
      logger.error(`Failed to get default provider (${providerId}). Falling back to anthropic.`, error);
      return this.getProvider('anthropic');
    }
  }
}