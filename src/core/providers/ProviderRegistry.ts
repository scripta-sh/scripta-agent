import { ILLMProvider } from './ILLMProvider';
import { createComponentLogger } from '../../utils/log';

// Create a logger for this component
const logger = createComponentLogger('ProviderRegistry');

/**
 * Registry for managing and accessing LLM providers
 */
export class ProviderRegistry {
  private static instance: ProviderRegistry;
  private providers: Map<string, ILLMProvider> = new Map();
  
  private constructor() {}
  
  /**
   * Get the singleton instance of the provider registry
   */
  public static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }
  
  /**
   * Register a provider with the registry
   * 
   * @param providerId Unique identifier for the provider (e.g., 'anthropic', 'openai')
   * @param provider Instance of the provider implementation
   */
  public registerProvider(providerId: string, provider: ILLMProvider): void {
    if (this.providers.has(providerId)) {
      logger.warn(`Provider '${providerId}' is already registered. Overwriting...`);
    }
    this.providers.set(providerId, provider);
    logger.debug(`Registered provider: ${providerId}`);
  }
  
  /**
   * Get a provider by its ID
   * 
   * @param providerId The ID of the provider to retrieve
   * @returns The provider instance, or undefined if not found
   */
  public getProvider(providerId: string): ILLMProvider | undefined {
    return this.providers.get(providerId);
  }
  
  /**
   * Check if a provider with the given ID is registered
   * 
   * @param providerId The ID to check
   * @returns True if the provider is registered, false otherwise
   */
  public hasProvider(providerId: string): boolean {
    return this.providers.has(providerId);
  }
  
  /**
   * Get all registered provider IDs
   * 
   * @returns Array of provider IDs
   */
  public getRegisteredProviders(): string[] {
    return Array.from(this.providers.keys());
  }
  
  /**
   * Clear all registered providers (mainly for testing)
   */
  public clearProviders(): void {
    this.providers.clear();
  }
}