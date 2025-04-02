import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { getTheme } from '../../utils/theme'
import { Select } from './CustomSelect/select'
import { Newline } from 'ink'
import { PRODUCT_NAME } from '@core/constants/product'
import { useExitOnCtrlCD } from '../../hooks/useExitOnCtrlCD'
import {
  getGlobalConfig,
  saveGlobalConfig,
  addApiKey,
  ProviderType,
} from '../../utils/config.js'
import models, { providers } from '@core/constants/models'
import TextInput from './TextInput'
import OpenAI from 'openai'
import chalk from 'chalk'
type Props = {
  onDone: () => void
  abortController?: AbortController
}

type ModelInfo = {
  model: string
  provider: string
  [key: string]: any
}

// Define model type options
type ModelTypeOption = 'both' | 'large' | 'small';

// Define reasoning effort options
type ReasoningEffortOption = 'low' | 'medium' | 'high';

// Custom hook to handle Escape key navigation
function useEscapeNavigation(onEscape: () => void, abortController?: AbortController) {
  // Use a ref to track if we've handled the escape key
  const handledRef = useRef(false);
  
  useInput((input, key) => {
    if (key.escape && !handledRef.current) {
      handledRef.current = true;
      // Reset after a short delay to allow for multiple escapes
      setTimeout(() => {
        handledRef.current = false;
      }, 100);
      onEscape();
    }
  }, { isActive: true });
}

function printModelConfig() {
  const config = getGlobalConfig()
  let res = `  ⎿  ${config.largeModelName} | ${config.largeModelMaxTokens} ${config.largeModelReasoningEffort ? config.largeModelReasoningEffort : ''}`
  res += `  |  ${config.smallModelName} | ${config.smallModelMaxTokens} ${config.smallModelReasoningEffort ? config.smallModelReasoningEffort : ''}`
  console.log(chalk.gray(res))
}

export function ModelSelector({ onDone: onDoneProp, abortController }: Props): React.ReactNode {
  const config = getGlobalConfig()
  const theme = getTheme()
  const onDone = () => {
    printModelConfig()
    onDoneProp()
  }
  
  // Create a clean exit function that resets all state
  const handleExit = () => {
    // Reset all temporary state before exiting
    setSelectedModel('')
    setApiKey('')
    setApiKeyEdited(false)
    setSelectedProvider(config.primaryProvider || 'anthropic')
    setModelLoadError(null)
    
    // Exit without saving changes
    process.exit(0)
  }
  
  // Initialize the exit hook with our clean exit function
  const exitState = useExitOnCtrlCD(handleExit)
  
  // Screen navigation stack
  const [screenStack, setScreenStack] = useState<Array<'modelType' | 'provider' | 'apiKey' | 'model' | 'modelParams' | 'confirmation'>>(['modelType'])
  
  // Current screen is always the last item in the stack
  const currentScreen = screenStack[screenStack.length - 1]
  
  // Function to navigate to a new screen
  const navigateTo = (screen: 'modelType' | 'provider' | 'apiKey' | 'model' | 'modelParams' | 'confirmation') => {
    setScreenStack(prev => [...prev, screen])
  }
  
  // Function to go back to the previous screen
  const goBack = () => {
    if (screenStack.length > 1) {
      // Remove the current screen from the stack
      setScreenStack(prev => prev.slice(0, -1))
    } else {
      // If we're at the first screen, reset all temporary state and exit
      setSelectedModel('')
      setApiKey('')
      setApiKeyEdited(false)
      setSelectedProvider(config.primaryProvider || 'anthropic')
      setModelLoadError(null)
      
      // Call onDone to exit without saving changes
      onDone()
    }
  }
  
  // State for model configuration
  const [selectedProvider, setSelectedProvider] = useState<ProviderType>(
    config.primaryProvider ?? 'anthropic'
  )
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [apiKey, setApiKey] = useState<string>('')
  
  // New state for model parameters
  const [maxTokens, setMaxTokens] = useState<string>(
    config.maxTokens?.toString() || ''
  )
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffortOption>('medium')
  const [supportsReasoningEffort, setSupportsReasoningEffort] = useState<boolean>(false)
  
  // Form focus state
  const [activeFieldIndex, setActiveFieldIndex] = useState(0)
  const [maxTokensCursorOffset, setMaxTokensCursorOffset] = useState<number>(0)
  
  // UI state
  const [modelTypeToChange, setModelTypeToChange] = useState<ModelTypeOption>('both')
  
  // Search and model loading state
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [modelLoadError, setModelLoadError] = useState<string | null>(null)
  const [modelSearchQuery, setModelSearchQuery] = useState<string>('')
  const [modelSearchCursorOffset, setModelSearchCursorOffset] = useState<number>(0)
  const [cursorOffset, setCursorOffset] = useState<number>(0)
  const [apiKeyEdited, setApiKeyEdited] = useState<boolean>(false)

  // Model type options
  const modelTypeOptions = [
    { label: 'Both Large and Small Models', value: 'both' },
    { label: 'Large Model Only', value: 'large' },
    { label: 'Small Model Only', value: 'small' }
  ]
  
  // Reasoning effort options
  const reasoningEffortOptions = [
    { label: 'Low - Faster responses, less thorough reasoning', value: 'low' },
    { label: 'Medium - Balanced speed and reasoning depth', value: 'medium' },
    { label: 'High - Slower responses, more thorough reasoning', value: 'high' }
  ]
  
  // Get available providers from models.ts
  const availableProviders = Object.keys(providers)
  
  // Create provider options with nice labels
  const providerOptions = availableProviders.map(provider => {
    const modelCount = models[provider]?.length || 0
    const label = getProviderLabel(provider, modelCount)
    return { 
      label,
      value: provider 
    }
  })
  
  // useEffect for initializing API key from existing config
  useEffect(() => {
    if(!apiKeyEdited && selectedProvider) {
      const config = getGlobalConfig();
      // Only use existing API key if it belongs to the current provider
      if (config.primaryProvider === selectedProvider && config.primaryApiKey) {
        setApiKey(config.primaryApiKey);
      } else {
        // When switching to a different provider, start with empty API key
        setApiKey('');
      }
    }
  }, [selectedProvider, apiKeyEdited])

  // Create a set of model names from our constants/models.ts for the current provider
  const ourModelNames = new Set(
    (models[selectedProvider as keyof typeof models] || [])
      .map((model: any) => model.model)
  )

  // Create model options from available models, filtered by search query
  const filteredModels = modelSearchQuery 
    ? availableModels.filter(model => 
        model.model.toLowerCase().includes(modelSearchQuery.toLowerCase()))
    : availableModels

  const modelOptions = filteredModels.map(model => {
    // Check if this model is in our constants/models.ts list
    const isInOurModels = ourModelNames.has(model.model)
    
    return {
      label: `${model.model}${getModelDetails(model)}`,
      value: model.model
    }
  })

  function getModelDetails(model: ModelInfo): string {
    const details = []
    
    if (model.max_tokens) {
      details.push(`${formatNumber(model.max_tokens)} tokens`)
    }
    
    if (model.supports_vision) {
      details.push('vision')
    }
    
    if (model.supports_function_calling) {
      details.push('tools')
    }
    
    return details.length > 0 ? ` (${details.join(', ')})` : ''
  }
  
  function formatNumber(num: number): string {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(0)}K`
    }
    return num.toString()
  }

  function getProviderLabel(provider: string, modelCount: number): string {
    // Use provider names from the providers object if available
    if (providers[provider]) {
      return `${providers[provider].name} ${providers[provider].status === 'wip' ? '(WIP)' : ''} (${modelCount} models)`
    }
    return `${provider}`
  }
  
  function handleModelTypeSelection(type: string) {
    setModelTypeToChange(type as ModelTypeOption)
    navigateTo('provider')
  }

  function handleProviderSelection(provider: string) {
    const providerType = provider as ProviderType
    setSelectedProvider(providerType)
    
    // Reset the selected model when changing providers to avoid invalid model names
    setSelectedModel('')
    
    // Try to get existing API key for this provider
    let existingKey = '';
    
    switch (providerType) {
      case 'anthropic':
        existingKey = config.anthropicApiKey || config.primaryApiKey || '';
        break;
      case 'openai':
        existingKey = config.openaiApiKey || '';
        break;
      case 'mistral':
        existingKey = config.mistralApiKey || '';
        break;
      case 'deepseek':
        existingKey = config.deepseekApiKey || '';
        break;
      case 'xai':
        existingKey = config.xaiApiKey || '';
        break;
      case 'groq':
        existingKey = config.groqApiKey || '';
        break;
      case 'gemini':
        existingKey = config.geminiApiKey || '';
        break;
      case 'ollama':
        existingKey = config.ollamaApiKey || '';
        break;
      case 'custom':
        existingKey = config.customApiKey || '';
        break;
    }
    
    // Set API key to existing value or empty string
    setApiKey(existingKey);
    setApiKeyEdited(false)
    
    if (provider === 'custom') {
      // For custom provider, save and exit
      saveConfiguration(providerType, selectedModel || config.largeModelName || '')
      onDone()
    } else {
      // Go to API key input for ALL providers (including Anthropic)
      navigateTo('apiKey')
    }
  }

  async function fetchGeminiModels() {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error?.message || `API error: ${response.status}`)
      }

      const { models } = await response.json()

      const geminiModels = models
        .filter((model: any) => model.supportedGenerationMethods.includes('generateContent'))
        .map((model: any) => ({
          model: model.name.replace('models/', ''),
          provider: 'gemini',
          max_tokens: model.outputTokenLimit,
          supports_vision: model.supportedGenerationMethods.includes('generateContent'),
          supports_function_calling: model.supportedGenerationMethods.includes('generateContent')
        }))

      return geminiModels
    } catch (error) {
      setModelLoadError(error instanceof Error ? error.message : 'Unknown error')
      throw error
    }
  }
  async function fetchAnthropicModels() {
    try {
      // For Anthropic, we'll use the predefined models from our constants
      const anthropicModelsList = models.anthropic || [];
      
      // Format the models to match our ModelInfo format
      const anthropicModels = anthropicModelsList.map(model => ({
        model: model.model,
        provider: 'anthropic',
        max_tokens: model.max_output_tokens || model.max_tokens,
        supports_vision: model.supports_vision || false,
        supports_function_calling: model.supports_function_calling || false,
        // Check for specific models that support reasoning effort
        // Claude 3 models support this feature
        supports_reasoning_effort: model.model.includes('claude-3')
      }));
      
      return anthropicModels;
    } catch (error) {
      setModelLoadError(`Failed to load Anthropic models: ${error.message}`);
      throw error;
    }
  }

  async function fetchModels() {
    setIsLoadingModels(true)
    setModelLoadError(null)
    
    try {
      // Skip API call if no API key provided (for all providers except 'custom' and 'ollama')
      if (!apiKey && selectedProvider !== 'custom' && selectedProvider !== 'ollama') {
        setModelLoadError('API key is required to fetch model list');
        return [];
      }
      
      let fetchedModels = [];
      
      // Special handling for Anthropic models - use predefined models from constants
      if (selectedProvider === 'anthropic') {
        const anthropicModels = await fetchAnthropicModels()
        setAvailableModels(anthropicModels)
        
        // Set a default Anthropic model if available
        if (anthropicModels.length > 0) {
          // Prefer claude-3-haiku if available
          const haikuModel = anthropicModels.find(model => model.model.includes('haiku'));
          if (haikuModel) {
            setSelectedModel(haikuModel.model);
          } else {
            // Otherwise use the first model
            setSelectedModel(anthropicModels[0].model);
          }
        }
        
        navigateTo('model')
        return anthropicModels
      }
      
      // Special handling for Gemini
      if (selectedProvider === 'gemini') {
        const geminiModels = await fetchGeminiModels()
        setAvailableModels(geminiModels)
        
        // Set a default Gemini model if available
        if (geminiModels.length > 0) {
          setSelectedModel(geminiModels[0].model);
        }
        
        navigateTo('model')
        return geminiModels
      }
      
      // For all other OpenAI-compatible providers, use the OpenAI client
      const baseURL = providers[selectedProvider]?.baseURL

      const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: baseURL,
        dangerouslyAllowBrowser: true
      })
      
      // Fetch the models
      const response = await openai.models.list()
      
      // Transform the response into our ModelInfo format
      fetchedModels = [] 
      for (const model of response.data) {
        const modelInfo = models[selectedProvider as keyof typeof models]?.find(m => m.model === model.id)
        fetchedModels.push({
          model: model.id,
          provider: selectedProvider,
          max_tokens: modelInfo?.max_output_tokens || modelInfo?.max_tokens,
          supports_vision: modelInfo?.supports_vision || false,
          supports_function_calling: modelInfo?.supports_function_calling || false,
          supports_reasoning_effort: modelInfo?.supports_reasoning_effort || false
        })
      }
      
      setAvailableModels(fetchedModels)
      
      // Set a default model if available
      if (fetchedModels.length > 0) {
        // For OpenAI, prefer gpt-3.5-turbo
        if (selectedProvider === 'openai') {
          const gptModel = fetchedModels.find(model => model.model.includes('gpt-3.5-turbo'));
          if (gptModel) {
            setSelectedModel(gptModel.model);
          } else {
            setSelectedModel(fetchedModels[0].model);
          }
        } 
        // For Mistral, prefer mistral-medium
        else if (selectedProvider === 'mistral') {
          const mistralModel = fetchedModels.find(model => model.model.includes('mistral-medium'));
          if (mistralModel) {
            setSelectedModel(mistralModel.model);
          } else {
            setSelectedModel(fetchedModels[0].model);
          }
        }
        // For DeepSeek, prefer deepseek-chat
        else if (selectedProvider === 'deepseek') {
          const deepseekModel = fetchedModels.find(model => model.model.includes('deepseek-chat'));
          if (deepseekModel) {
            setSelectedModel(deepseekModel.model);
          } else {
            setSelectedModel(fetchedModels[0].model);
          }
        }
        // Default to first model for other providers
        else {
          setSelectedModel(fetchedModels[0].model);
        }
      }
      
      // Navigate to model selection screen if models were loaded successfully
      navigateTo('model')
      
      return fetchedModels
    } catch (error) {
      console.error('Error fetching models:', error)
      setModelLoadError(`Failed to load models: ${error.message}`)
      throw error
    } finally {
      setIsLoadingModels(false)
    }
  }
  
  function handleApiKeySubmit(key: string) {
    setApiKey(key)
    
    // Fetch models with the provided API key
    fetchModels()
      .catch(error => {
        setModelLoadError(`Error loading models: ${error.message}`)
      })
  }
  
  function handleModelSelection(model: string) {
    setSelectedModel(model)
    
    // Check if the selected model supports reasoning_effort
    const modelInfo = availableModels.find(m => m.model === model)
    setSupportsReasoningEffort(modelInfo?.supports_reasoning_effort || false)
    
    if(!modelInfo?.supports_reasoning_effort) {
      setReasoningEffort(null)
    }

    // Prepopulate max tokens with the model's default value if available
    if (modelInfo?.max_tokens) {
      setMaxTokens(modelInfo.max_tokens.toString())
      setMaxTokensCursorOffset(modelInfo.max_tokens.toString().length)
    } else {
      // If no model-specific max tokens, use the global config value or empty string
      setMaxTokens(config.maxTokens?.toString() || '')
      setMaxTokensCursorOffset(config.maxTokens?.toString().length || 0)
    }
    
    // Go to model parameters screen
    navigateTo('modelParams')
    // Reset active field index
    setActiveFieldIndex(0)
  }
  
  const handleModelParamsSubmit = () => {
    // Values are already in state, no need to extract from form
    // Navigate to confirmation screen
    navigateTo('confirmation')
  }

  
  function saveConfiguration(provider: ProviderType, model: string) {
    const baseURL = providers[provider]?.baseURL || ""
    
    // Get default model for the provider if none is selected
    let modelToUse = model;
    if (!modelToUse || modelToUse === '') {
      // Set appropriate default models based on provider
      if (provider === 'anthropic') {
        modelToUse = 'claude-3-haiku-20240307'
      } else if (provider === 'openai') {
        modelToUse = 'gpt-3.5-turbo'
      } else if (provider === 'mistral') {
        modelToUse = 'mistral-medium'
      } else if (provider === 'deepseek') {
        modelToUse = 'deepseek-chat'
      } else {
        // For other providers, use the existing model name or empty string
        modelToUse = config.largeModelName || ''
      }
    }
    
    // Create a new config object based on the existing one
    const newConfig = { ...config }
    
    // Always update the primary provider and set primaryApiKey
    newConfig.primaryProvider = provider
    if (apiKey) {
      // Store in both primaryApiKey for backward compatibility and in provider-specific field
      newConfig.primaryApiKey = apiKey
      
      // Also store in the provider-specific field
      switch (provider) {
        case 'anthropic':
          newConfig.anthropicApiKey = apiKey;
          break;
        case 'openai':
          newConfig.openaiApiKey = apiKey;
          break;
        case 'mistral':
          newConfig.mistralApiKey = apiKey;
          break;
        case 'deepseek':
          newConfig.deepseekApiKey = apiKey;
          break;
        case 'xai':
          newConfig.xaiApiKey = apiKey;
          break;
        case 'groq':
          newConfig.groqApiKey = apiKey;
          break;
        case 'gemini':
          newConfig.geminiApiKey = apiKey;
          break;
        case 'ollama':
          newConfig.ollamaApiKey = apiKey;
          break;
        case 'custom':
          newConfig.customApiKey = apiKey;
          break;
      }
    }
    
    // Set API key requirement - only for providers that need API keys
    const apiKeyRequired = provider !== 'custom' && provider !== 'ollama';
    
    // Update the appropriate model based on the selection
    if (modelTypeToChange === 'both' || modelTypeToChange === 'large') {
      newConfig.largeModelName = modelToUse
      newConfig.largeModelBaseURL = baseURL
      
      // Always set API key in config if provided
      if (apiKey) {
        newConfig.largeModelApiKeys = [apiKey]
      }
      
      if (maxTokens) {
        newConfig.largeModelMaxTokens = parseInt(maxTokens)
      }
      
      if (reasoningEffort) {
        newConfig.largeModelReasoningEffort = reasoningEffort
      } else {
        newConfig.largeModelReasoningEffort = undefined
      }
      
      // Set API key requirement based on provider
      newConfig.largeModelApiKeyRequired = apiKeyRequired
    }
    
    if (modelTypeToChange === 'both' || modelTypeToChange === 'small') {
      newConfig.smallModelName = modelToUse
      newConfig.smallModelBaseURL = baseURL
      
      // Always set API key in config if provided
      if (apiKey) {
        newConfig.smallModelApiKeys = [apiKey]
      }
      
      if (maxTokens) {
        newConfig.smallModelMaxTokens = parseInt(maxTokens)
      }
      
      if (reasoningEffort) {
        newConfig.smallModelReasoningEffort = reasoningEffort
      } else {
        newConfig.smallModelReasoningEffort = undefined
      }
      
      // Set API key requirement based on provider
      newConfig.smallModelApiKeyRequired = apiKeyRequired
    }
    
    // Save the updated configuration
    saveGlobalConfig(newConfig)
  }
  
  function handleConfirmation() {
    // Save the configuration and exit
    saveConfiguration(selectedProvider, selectedModel)
    onDone()
  }
  
  // Handle back navigation based on current screen
  const handleBack = () => {
    if (currentScreen === 'modelType') {
      // If we're at the first screen, call onDone to exit
      onDone()
    } else {
      // Remove the current screen from the stack
      setScreenStack(prev => prev.slice(0, -1))
    }
  }
  
  // Use escape navigation hook
  useEscapeNavigation(handleBack, abortController);
  
  // Handle cursor offset changes
  function handleCursorOffsetChange(offset: number) {
    setCursorOffset(offset)
  }
  
  // Handle API key changes
  function handleApiKeyChange(value: string) {
    setApiKeyEdited(true)
    setApiKey(value)
  }
  
  // Handle model search query changes
  function handleModelSearchChange(value: string) {
    setModelSearchQuery(value)
    // Update cursor position to end of text when typing
    setModelSearchCursorOffset(value.length)
  }
  
  // Handle model search cursor offset changes
  function handleModelSearchCursorOffsetChange(offset: number) {
    setModelSearchCursorOffset(offset)
  }

  // Handle Tab key for form navigation in model params screen
  useInput((input, key) => {
    // Handle API key submission on Enter
    if (currentScreen === 'apiKey' && key.return) {
      if (apiKey) {
        handleApiKeySubmit(apiKey)
      }
      return
    }

    if (currentScreen === 'apiKey' && key.tab) {
      // Skip API key input and fetch models
      fetchModels()
        .catch(error => {
          setModelLoadError(`Error loading models: ${error.message}`)
        })
      return
    }
    
    // Handle confirmation on Enter
    if (currentScreen === 'confirmation' && key.return) {
      handleConfirmation()
      return
    }
    
    // Handle paste event (Ctrl+V or Cmd+V)
    if (currentScreen === 'apiKey' && ((key.ctrl && input === 'v') || (key.meta && input === 'v'))) {
      // We can't directly access clipboard in terminal, but we can show a message
      setModelLoadError('Please use your terminal\'s paste functionality or type the API key manually')
      return
    }
    
    
    // Handle Tab key for form navigation in model params screen
    if (currentScreen === 'modelParams' && key.tab) {
      const formFields = getFormFieldsForModelParams();
      // Move to next field
      setActiveFieldIndex((current) => (current + 1) % formFields.length);
      return
    }
    
    // Handle Enter key for form submission in model params screen
    if (currentScreen === 'modelParams' && key.return) {
      const formFields = getFormFieldsForModelParams();
      
      if (activeFieldIndex === formFields.length - 1) {
        // If on the Continue button, submit the form
        handleModelParamsSubmit()
      } else {
        // If on any other field, move to the next field
        // This is important for select fields that don't auto-advance when Enter is pressed
        const currentField = formFields[activeFieldIndex];
        if (currentField.component === 'select') {
          // For select fields, just advance to the next field
          setActiveFieldIndex((current) => (current + 1) % formFields.length);
        }
      }
      return
    }
  });

  // Helper function to get form fields for model params
  function getFormFieldsForModelParams() {
    return [
      {
        name: 'maxTokens',
        label: 'Maximum Tokens',
        description: 'Maximum tokens in response. Empty = default.',
        placeholder: 'Default',
        value: maxTokens,
        component: 'textInput',
        componentProps: {
          columns: 10,
        }
      },
      ...(supportsReasoningEffort ? [{
        name: 'reasoningEffort',
        label: 'Reasoning Effort',
        description: 'Controls reasoning depth for complex problems.',
        value: reasoningEffort,
        component: 'select'
      }] : []),
      {
        name: 'submit',
        label: 'Continue →',
        component: 'button'
      }
    ];
  }

  // Render Model Type Selection Screen
  if (currentScreen === 'modelType') {
    return (
      <Box flexDirection="column" gap={1}>
        <Box 
          flexDirection="column" 
          gap={1} 
          borderStyle="round"
          borderColor={theme.secondaryBorder}
          paddingX={2}
          paddingY={1}
        >
          <Text bold>
            Model Selection {exitState.pending ? `(press ${exitState.keyName} again to exit)` : ''}
          </Text>
          <Box flexDirection="column" gap={1}>
            <Text bold>Which model(s) would you like to configure?</Text>
            <Box flexDirection="column" width={70}>
              <Text color={theme.secondaryText}>
                You can configure both models to be the same, or set them individually.
                <Newline />
                • Large model: Used for complex tasks requiring full capabilities
                <Newline />
                • Small model: Used for simpler tasks to save costs and improve response times
              </Text>
            </Box>
            
            <Select
              options={modelTypeOptions}
              onChange={handleModelTypeSelection}
            />
            
            <Box marginTop={1}>
              <Text dimColor>
                Current configuration:
                <Newline />
                • Large model: <Text color={theme.suggestion}>{config.largeModelName || 'Not set'}</Text>
                {config.largeModelName && (
                  <Text dimColor> ({providers[config.primaryProvider]?.name || config.primaryProvider})</Text>
                )}
                <Newline />
                • Small model: <Text color={theme.suggestion}>{config.smallModelName || 'Not set'}</Text>
                {config.smallModelName && (
                  <Text dimColor> ({providers[config.primaryProvider]?.name || config.primaryProvider})</Text>
                )}
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  // Render API Key Input Screen
  if (currentScreen === 'apiKey') {
    const modelTypeText = modelTypeToChange === 'both' 
      ? 'both models' 
      : `your ${modelTypeToChange} model`;
    
    return (
      <Box flexDirection="column" gap={1}>
        <Box 
          flexDirection="column" 
          gap={1} 
          borderStyle="round"
          borderColor={theme.secondaryBorder}
          paddingX={2}
          paddingY={1}
        >
          <Text bold>
            API Key Setup {exitState.pending ? `(press ${exitState.keyName} again to exit)` : ''}
          </Text>
          <Box flexDirection="column" gap={1}>
            <Text bold>Enter your {getProviderLabel(selectedProvider, 0).split(' (')[0]} API key for {modelTypeText}:</Text>
            <Box flexDirection="column" width={70}>
              <Text color={theme.secondaryText}>
                This key will be stored locally and used to access the {selectedProvider} API.
                <Newline />
                Your key is never sent to our servers.
              </Text>
            </Box>
            
            <Box>
              <TextInput
                placeholder="sk-..."
                value={apiKey}
                onChange={handleApiKeyChange}
                onSubmit={handleApiKeySubmit}
                mask="*"
                columns={100}
                cursorOffset={cursorOffset}
                onChangeCursorOffset={handleCursorOffsetChange}
                showCursor={true}
              />
            </Box>
            
            <Box marginTop={1}>
              <Text>
                <Text color={theme.suggestion} dimColor={!apiKey}>
                  [Submit API Key]
                </Text>
                <Text> - Press Enter or click to continue with this API key</Text>
              </Text>
            </Box>
            
            {isLoadingModels && (
              <Box>
                <Text color={theme.suggestion}>Loading available models...</Text>
              </Box>
            )}
            {modelLoadError && (
              <Box>
                <Text color="red">Error: {modelLoadError}</Text>
              </Box>
            )}
            <Box marginTop={1}>
              <Text dimColor>
                Press <Text color={theme.suggestion}>Enter</Text> to continue, <Text color={theme.suggestion}>Tab</Text> to skip using a key, or <Text color={theme.suggestion}>Esc</Text> to go back
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  // Render Model Selection Screen
  if (currentScreen === 'model') {
    const modelTypeText = modelTypeToChange === 'both' 
      ? 'both large and small models' 
      : `your ${modelTypeToChange} model`;
    
    return (
      <Box flexDirection="column" gap={1}>
        <Box 
          flexDirection="column" 
          gap={1} 
          borderStyle="round"
          borderColor={theme.secondaryBorder}
          paddingX={2}
          paddingY={1}
        >
          <Text bold>
            Model Selection {exitState.pending ? `(press ${exitState.keyName} again to exit)` : ''}
          </Text>
          <Box flexDirection="column" gap={1}>
            <Text bold>Select a model from {getProviderLabel(selectedProvider, availableModels.length).split(' (')[0]} for {modelTypeText}:</Text>
            <Box flexDirection="column" width={70}>
              <Text color={theme.secondaryText}>
                {modelTypeToChange === 'both' ? (
                  <>This model will be used for both your primary interactions and simpler tasks.</>
                ) : modelTypeToChange === 'large' ? (
                  <>This model will be used for complex tasks requiring full capabilities.</>
                ) : (
                  <>This model will be used for simpler tasks to save costs and improve response times.</>
                )}
              </Text>
            </Box>
            
            <Box marginY={1}>
              <Text bold>Search models:</Text>
              <TextInput
                placeholder="Type to filter models..."
                value={modelSearchQuery}
                onChange={handleModelSearchChange}
                columns={100}
                cursorOffset={modelSearchCursorOffset}
                onChangeCursorOffset={handleModelSearchCursorOffsetChange}
                showCursor={true}
                focus={true}
              />
            </Box>
            
            {modelOptions.length > 0 ? (
              <>
                <Select
                  options={modelOptions}
                  onChange={handleModelSelection}
                />
                <Text dimColor>
                  Showing {modelOptions.length} of {availableModels.length} models
                </Text>
              </>
            ) : (
              <Box>
                {availableModels.length > 0 ? (
                  <Text color="yellow">No models match your search. Try a different query.</Text>
                ) : (
                  <Text color="yellow">No models available for this provider.</Text>
                )}
              </Box>
            )}
            
            <Box marginTop={1}>
              <Text dimColor>
                Press <Text color={theme.suggestion}>Esc</Text> to go back to API key input
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  if (currentScreen === 'modelParams') {
    // Define form fields
    const formFields = getFormFieldsForModelParams();

    return (
      <Box flexDirection="column" gap={1}>
        <Box 
          flexDirection="column" 
          gap={1} 
          borderStyle="round"
          borderColor={theme.secondaryBorder}
          paddingX={2}
          paddingY={1}
        >
          <Text bold>
            Model Parameters {exitState.pending ? `(press ${exitState.keyName} again to exit)` : ''}
          </Text>
          <Box flexDirection="column" gap={1}>
            <Text bold>Configure parameters for {selectedModel}:</Text>
            <Box flexDirection="column" width={70}>
              <Text color={theme.secondaryText}>
                Use <Text color={theme.suggestion}>Tab</Text> to navigate between fields. Press <Text color={theme.suggestion}>Enter</Text> to submit.
              </Text>
            </Box>
            
            <Box flexDirection="column">
              {formFields.map((field, index) => (
                <Box flexDirection="column" marginY={1} key={field.name}>
                  {field.component !== 'button' ? (
                    <>
                      <Text bold color={activeFieldIndex === index ? theme.success : undefined}>
                        {field.label}
                      </Text>
                      {field.description && (
                        <Text color={theme.secondaryText}>
                          {field.description}
                        </Text>
                      )}
                    </>
                  ) : (
                    <Text bold color={activeFieldIndex === index ? theme.success : undefined}>
                      {field.label}
                    </Text>
                  )}
                  <Box marginY={1}>
                    {activeFieldIndex === index ? (
                      field.component === 'textInput' ? (
                        <TextInput
                          value={maxTokens}
                          onChange={(value) => setMaxTokens(value)}
                          placeholder={field.placeholder}
                          columns={field.componentProps?.columns || 50}
                          showCursor={true}
                          focus={true}
                          cursorOffset={maxTokensCursorOffset}
                          onChangeCursorOffset={setMaxTokensCursorOffset}
                          onSubmit={() => {
                            if (index === formFields.length - 1) {
                              handleModelParamsSubmit();
                            } else {
                              setActiveFieldIndex(index + 1);
                            }
                          }}
                        />
                      ) : field.component === 'select' ? (
                        <Select
                          options={reasoningEffortOptions}
                          onChange={(value) => {
                            setReasoningEffort(value as ReasoningEffortOption);
                            // Move to next field after selection
                            setTimeout(() => {
                              setActiveFieldIndex(index+1);
                            }, 100);
                          }}
                          defaultValue={reasoningEffort}
                        />
                      ) : null
                    ) : (
                      field.name === 'maxTokens' ? (
                        <Text color={theme.secondaryText}>
                          Current: <Text color={theme.suggestion}>{maxTokens || 'Default'}</Text>
                        </Text>
                      ) : field.name === 'reasoningEffort' ? (
                        <Text color={theme.secondaryText}>
                          Current: <Text color={theme.suggestion}>{reasoningEffort}</Text>
                        </Text>
                      ) : null
                    )}
                  </Box>
                </Box>
              ))}
              
              <Box marginTop={1}>
                <Text dimColor>
                  Press <Text color={theme.suggestion}>Tab</Text> to navigate, <Text color={theme.suggestion}>Enter</Text> to continue, or <Text color={theme.suggestion}>Esc</Text> to go back
                </Text>
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
    );
  }

  // Render Confirmation Screen
  if (currentScreen === 'confirmation') {
    // Determine what will be updated
    const updatingLarge = modelTypeToChange === 'both' || modelTypeToChange === 'large'
    const updatingSmall = modelTypeToChange === 'both' || modelTypeToChange === 'small'
    
    // Get provider display name
    const providerDisplayName = getProviderLabel(selectedProvider, 0).split(' (')[0]
    
    return (
      <Box flexDirection="column" gap={1}>
        <Box 
          flexDirection="column" 
          gap={1} 
          borderStyle="round"
          borderColor={theme.secondaryBorder}
          paddingX={2}
          paddingY={1}
        >
          <Text bold>
            Configuration Confirmation {exitState.pending ? `(press ${exitState.keyName} again to exit)` : ''}
          </Text>
          <Box flexDirection="column" gap={1}>
            <Text bold>Confirm your model configuration:</Text>
            <Box flexDirection="column" width={70}>
              <Text color={theme.secondaryText}>
                Please review your selections before saving.
              </Text>
            </Box>
            
            <Box flexDirection="column" marginY={1} paddingX={1}>
              <Text>
                <Text bold>Provider: </Text>
                <Text color={theme.suggestion}>{providerDisplayName}</Text>
              </Text>
              
              {updatingLarge && (
                <Text>
                  <Text bold>Large Model: </Text>
                  <Text color={theme.suggestion}>{selectedModel}</Text>
                  <Text dimColor> (for complex tasks)</Text>
                </Text>
              )}
              
              {updatingSmall && (
                <Text>
                  <Text bold>Small Model: </Text>
                  <Text color={theme.suggestion}>
                    {modelTypeToChange === 'both' ? selectedModel : config.smallModelName || 'Not set'}
                  </Text>
                  <Text dimColor> (for simpler tasks)</Text>
                </Text>
              )}
              
              {apiKey && (
                <Text>
                  <Text bold>API Key: </Text>
                  <Text color={theme.suggestion}>****{apiKey.slice(-4)}</Text>
                </Text>
              )}
              
              {maxTokens && (
                <Text>
                  <Text bold>Max Tokens: </Text>
                  <Text color={theme.suggestion}>{maxTokens}</Text>
                </Text>
              )}
              
              {supportsReasoningEffort && (
                <Text>
                  <Text bold>Reasoning Effort: </Text>
                  <Text color={theme.suggestion}>{reasoningEffort}</Text>
                </Text>
              )}
            </Box>
            
            <Box marginTop={1}>
              <Text dimColor>
                Press <Text color={theme.suggestion}>Esc</Text> to go back to model parameters or <Text color={theme.suggestion}>Enter</Text> to save configuration
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  // Render Provider Selection Screen
  return (
    <Box flexDirection="column" gap={1}>
      <Box 
        flexDirection="column" 
        gap={1} 
        borderStyle="round"
        borderColor={theme.secondaryBorder}
        paddingX={2}
        paddingY={1}
      >
        <Text bold>
          Provider Selection {exitState.pending ? `(press ${exitState.keyName} again to exit)` : ''}
        </Text>
        <Box flexDirection="column" gap={1}>
          <Text bold>
            Select your preferred AI provider for {modelTypeToChange === 'both' 
              ? 'both models' 
              : `your ${modelTypeToChange} model`}:
          </Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              Choose the provider you want to use for {modelTypeToChange === 'both' 
                ? 'both large and small models' 
                : `your ${modelTypeToChange} model`}.
              <Newline />
              This will determine which models are available to you.
            </Text>
          </Box>
          
          <Select
            options={providerOptions}
            onChange={handleProviderSelection}
          />
          
          <Box marginTop={1}>
            <Text dimColor>
              You can change this later by running <Text color={theme.suggestion}>/model</Text> again
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  )
} 