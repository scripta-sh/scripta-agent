import { Box, Text, useInput } from 'ink'
import * as React from 'react'
import { useState } from 'react'
import figures from 'figures'
import { getTheme } from '../utils/theme'
import {
  GlobalConfig,
  saveGlobalConfig,
  normalizeApiKeyForConfig,
  ProviderType,
} from '../utils/config.js'
import { getGlobalConfig } from '../utils/config'
import chalk from 'chalk'
import { useExitOnCtrlCD } from '../hooks/useExitOnCtrlCD'

type Props = {
  onClose: () => void
}

type Setting =
  | {
      id: string
      label: string
      value: boolean
      onChange(value: boolean): void
      type: 'boolean',
      disabled?: boolean
    }
  | {
      id: string
      label: string
      value: string
      options: string[]
      onChange(value: string): void
      type: 'enum',
      disabled?: boolean
    }
  | {
      id: string
      label: string
      value: string
      onChange(value: string): void
      type: 'string',
      disabled?: boolean
    }
  | {
      id: string
      label: string
      value: number
      onChange(value: number): void
      type: 'number',
      disabled?: boolean
    }

export function Config({ onClose }: Props): React.ReactNode {
  const [globalConfig, setGlobalConfig] = useState(getGlobalConfig())
  const initialConfig = React.useRef(getGlobalConfig())
  const [selectedIndex, setSelectedIndex] = useState(0)
  const exitState = useExitOnCtrlCD(() => process.exit(0))
  const [editingString, setEditingString] = useState(false)
  const [currentInput, setCurrentInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)

  // TODO: Add MCP servers
  const settings: Setting[] = [
    // Global settings
    {
      id: 'provider',
      label: 'AI Provider',
      value: globalConfig.primaryProvider ?? 'anthropic',
      options: ['anthropic', 'openai', 'custom'],
      type: 'enum',
      onChange(provider: ProviderType) {
        const config = { ...getGlobalConfig(), primaryProvider: provider }
        saveGlobalConfig(config)
        setGlobalConfig(config)
      },
    },
    {
      id: 'smallModelName',
      label: 'Small model name',
      value: globalConfig.smallModelName ?? '',
      type: 'string',
      onChange(value: string) {
        const config = { ...getGlobalConfig(), smallModelName: value }
        saveGlobalConfig(config)
        setGlobalConfig(config)
      },
    },
    {
      id: 'small_apiKeyRequired',
      label: `Small model require API key`,
      value: globalConfig.smallModelApiKeyRequired ?? false,
      type: 'boolean',
      onChange(value: boolean) {
        const config = { ...getGlobalConfig(), smallModelApiKeyRequired: value }
        saveGlobalConfig(config)
        setGlobalConfig(config)
      },
    },
    {
      id: 'small_apiKey',
      label: `API key for small model`,
      value: globalConfig.smallModelApiKey ?? '',
      type: 'string',
      disabled: !getGlobalConfig().smallModelApiKeyRequired,
      onChange(value: string) {
        const config = { ...getGlobalConfig(), smallModelApiKey: value }
        saveGlobalConfig(config)
        setGlobalConfig(config)
      },
    },
    {
      id: 'smallModelBaseURL',
      label: 'Small model base URL',
      value: globalConfig.smallModelBaseURL ?? '',
      type: 'string',
      onChange(value: string) {
        const config = { ...getGlobalConfig(), smallModelBaseURL: value }
        saveGlobalConfig(config)
        setGlobalConfig(config)
      },
    },
    {
      id: 'smallModelMaxTokens',
      label: 'Small model max tokens',
      value: globalConfig.smallModelMaxTokens ?? 8192,
      type: 'number',
      onChange(value: number) {
        const config = { ...getGlobalConfig(), smallModelMaxTokens: value }
        saveGlobalConfig(config)
        setGlobalConfig(config)
      }
    },
    {
      id: 'smallModelReasoningEffort',
      label: 'Small model reasoning effort',
      value: globalConfig.smallModelReasoningEffort,
      options: ['low', 'medium', 'high', ''],
      type: 'enum',
      onChange(value: string) {
        const config = { ...getGlobalConfig(), smallModelReasoningEffort: value as 'low' | 'medium' | 'high' | undefined }
        saveGlobalConfig(config)
        setGlobalConfig(config)
      }
    },    
    {
      id: 'largeModelName',
      label: 'Large model name',
      value: globalConfig.largeModelName ?? '',
      type: 'string',
      onChange(value: string) {
        const config = { ...getGlobalConfig(), largeModelName: value }
        saveGlobalConfig(config)
        setGlobalConfig(config)
      },
    },
    {
      id: 'large_apiKeyRequired',
      label: `Large model require API key`,
      value: globalConfig.largeModelApiKeyRequired ?? false,
      type: 'boolean',
      onChange(value: boolean) {
        const config = { ...getGlobalConfig(), largeModelApiKeyRequired: value }
        saveGlobalConfig(config)
        setGlobalConfig(config)
      },
    },
    {
      id: 'large_apiKey',
      label: `API key for large model`,
      value: globalConfig.largeModelApiKey ?? '',
      type: 'string',
      disabled: !getGlobalConfig().largeModelApiKeyRequired,
      onChange(value: string) {
        const config = { ...getGlobalConfig(), largeModelApiKey: value }
        saveGlobalConfig(config)
        setGlobalConfig(config)
      },
    },  
    {
      id: 'largeModelBaseURL',
      label: 'Large model base URL',
      value: globalConfig.largeModelBaseURL ?? '',
      type: 'string',
      onChange(value: string) {
        const config = { ...getGlobalConfig(), largeModelBaseURL: value }
        saveGlobalConfig(config)
        setGlobalConfig(config)
      },
    },
    {
      id: 'largeModelMaxTokens',
      label: 'Large model max tokens',
      value: globalConfig.largeModelMaxTokens ?? 8192,
      type: 'number',
      onChange(value: number) {
        const config = { ...getGlobalConfig(), largeModelMaxTokens: value }
        saveGlobalConfig(config)
        setGlobalConfig(config)
      },
    },
    {
      id: 'largeModelReasoningEffort',
      label: 'Large model reasoning effort',
      value: globalConfig.largeModelReasoningEffort,
      options: ['low', 'medium', 'high', ''],
      type: 'enum',
      onChange(value: string) {
        const config = { ...getGlobalConfig(), largeModelReasoningEffort: value as 'low' | 'medium' | 'high' | undefined }
        saveGlobalConfig(config)
        setGlobalConfig(config)
      },
    },
    {
      id: 'proxy',
      label: 'proxy used for http request',
      value: globalConfig.proxy,
      type: 'string',
      onChange(value: string) {
        const config = { ...getGlobalConfig(), proxy: value }
        saveGlobalConfig(config)
        setGlobalConfig(config)
      },
    },
    {
      id: 'verbose',
      label: 'Verbose output',
      value: globalConfig.verbose,
      type: 'boolean',
      onChange(verbose: boolean) {
        const config = { ...getGlobalConfig(), verbose }
        saveGlobalConfig(config)
        setGlobalConfig(config)
      },
    },
    {
      id: 'stream',
      label: 'Stream output',
      value: globalConfig.stream ?? true,
      type: 'boolean',
      onChange(stream: boolean) {
        const config = { ...getGlobalConfig(), stream }
        saveGlobalConfig(config)
        setGlobalConfig(config)
      },
    },
    {
      id: 'theme',
      label: 'Theme',
      value: globalConfig.theme,
      options: ['light', 'dark', 'light-daltonized', 'dark-daltonized'],
      type: 'enum',
      onChange(theme: GlobalConfig['theme']) {
        const config = { ...getGlobalConfig(), theme }
        saveGlobalConfig(config)
        setGlobalConfig(config)
      },
    },
    {
      id: 'notifChannel',
      label: 'Notifications',
      value: globalConfig.preferredNotifChannel,
      options: [
        'iterm2',
        'terminal_bell',
        'iterm2_with_bell',
        'notifications_disabled',
      ],
      type: 'enum',
      onChange(notifChannel: GlobalConfig['preferredNotifChannel']) {
        const config = {
          ...getGlobalConfig(),
          preferredNotifChannel: notifChannel,
        }
        saveGlobalConfig(config)
        setGlobalConfig(config)
      },
    },
  ]

  useInput((input, key) => {
    if (editingString) {
      // Handle input when editing a string value
      if (key.escape) {
        setEditingString(false)
        setCurrentInput('')
        setInputError(null)
        return
      }

      if (key.return) {
        const setting = settings[selectedIndex]
        if (setting.type === 'string') {
          setting.onChange(currentInput)
        } else if (setting.type === 'number') {
          const numValue = Number(currentInput)
          if (!isNaN(numValue)) {
            setting.onChange(numValue)
          } else {
            setInputError('Invalid number')
            return
          }
        }
        setEditingString(false)
        setCurrentInput('')
        setInputError(null)
        return
      }

      if (key.backspace || key.delete) {
        setCurrentInput(prev => prev.slice(0, -1))
        return
      }

      // Add all input characters to the string (including pasted content)
      if (input) {
        try {
          // Clean the input: remove newlines and other control characters
          const cleanedInput = input
            .replace(/[\r\n\t]/g, '') // Remove newlines and tabs
          
          if (cleanedInput) {
            setCurrentInput(prev => prev + cleanedInput)
            setInputError(null)
          }
        } catch (error) {
          setInputError('Error processing input')
        }
      }
      
      return
    }

    if (key.escape) {
      // Log any changes that were made
      // TODO: Make these proper messages
      const changes: string[] = []
      // Check for API key changes
      const initialUsingCustomKey = Boolean(
        process.env.ANTHROPIC_API_KEY &&
          initialConfig.current.customApiKeyResponses?.approved?.includes(
            normalizeApiKeyForConfig(process.env.ANTHROPIC_API_KEY),
          ),
      )
      const currentUsingCustomKey = Boolean(
        process.env.ANTHROPIC_API_KEY &&
          globalConfig.customApiKeyResponses?.approved?.includes(
            normalizeApiKeyForConfig(process.env.ANTHROPIC_API_KEY),
          ),
      )
      if (initialUsingCustomKey !== currentUsingCustomKey) {
        changes.push(
          `  ⎿  ${currentUsingCustomKey ? 'Enabled' : 'Disabled'} custom API key`,
        )
      }

      if (globalConfig.verbose !== initialConfig.current.verbose) {
        changes.push(`  ⎿  Set verbose to ${chalk.bold(globalConfig.verbose)}`)
      }
      if (globalConfig.theme !== initialConfig.current.theme) {
        changes.push(`  ⎿  Set theme to ${chalk.bold(globalConfig.theme)}`)
      }
      if (
        globalConfig.preferredNotifChannel !==
        initialConfig.current.preferredNotifChannel
      ) {
        changes.push(
          `  ⎿  Set notifications to ${chalk.bold(globalConfig.preferredNotifChannel)}`,
        )
      }
      if (changes.length > 0) {
        console.log(chalk.gray(changes.join('\n')))
      }
      onClose()
      return
    }

    function toggleSetting() {
      const setting = settings[selectedIndex]
      if (!setting || !setting.onChange) {
        return
      }

      if (setting.disabled === true) {
        return
      }

      if (setting.type === 'boolean') {
        setting.onChange(!setting.value)
        return
      }

      if (setting.type === 'enum') {
        const currentIndex = setting.options.indexOf(setting.value)
        const nextIndex = (currentIndex + 1) % setting.options.length
        setting.onChange(setting.options[nextIndex]!)
        return
      }

      if (setting.type === 'string' || setting.type === 'number') {
        setEditingString(true)
        setCurrentInput(setting.value?.toString() ?? '')
        return
      }
    }

    if (key.return || input === ' ') {
      toggleSetting()
      return
    }

    // Find next setting index glossing over disabled fields
    const moveSelection = (direction: -1 | 1) => {
      let newIndex = selectedIndex;
    
      while (true) {
        newIndex += direction;
    
        // Stop if out of bounds
        if (newIndex < 0 || newIndex >= settings.length) return;
    
        // Set new index if it's not disabled
        if (!settings[newIndex].disabled) {
          setSelectedIndex(newIndex);
          return;
        }
      }
    };
    
    if (key.upArrow) moveSelection(-1);
    if (key.downArrow) moveSelection(1);
  })

  return (
    <>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={getTheme().secondaryBorder}
        paddingX={1}
        marginTop={1}
      >
        <Box flexDirection="column" minHeight={2} marginBottom={1}>
          <Text bold>Settings</Text>
          <Text dimColor>Configure preferences</Text>
        </Box>

        {settings.map((setting, i) => {
          const isSelected = i === selectedIndex
          const isEditing = isSelected && editingString && (setting.type === 'string' || setting.type === 'number')

          return (
            <Box key={setting.id} height={2} minHeight={2}>
              <Box width={44}>
                <Text color={isSelected ? 'blue' : undefined} dimColor={setting.disabled ? true : undefined}>
                  {isSelected ? figures.pointer : ' '} {setting.label}
                </Text>
              </Box>
              <Box>
                {setting.type === 'boolean' ? (
                  <Text color={isSelected ? 'blue' : undefined} dimColor={setting.disabled ? true : undefined}>
                    {setting.value.toString()}
                  </Text>
                ) : setting.type === 'string' ? (
                  isEditing ? (
                    <Box>
                      <Text backgroundColor="blue" color="white">
                        {currentInput || ' '}<Text color="white">_</Text>
                      </Text>
                      {inputError && <Text color="red"> {inputError}</Text>}
                    </Box>
                  ) : (
                    <Text color={isSelected ? 'blue' : undefined} dimColor={setting.disabled ? true : undefined}>
                      {setting.value ? normalizeApiKeyForConfig(setting.value) : '(not set)'} {isSelected ? '[Enter to edit]' : ''}
                    </Text>
                  )
                ) : setting.type === 'number' ? (
                  isEditing ? (
                    <Box>
                      <Text backgroundColor="blue" color="white">
                        {currentInput || ' '}<Text color="white">_</Text>
                      </Text>
                      {inputError && <Text color="red"> {inputError}</Text>}
                    </Box>
                  ) : (
                    <Text color={isSelected ? 'blue' : undefined} dimColor={setting.disabled ? true : undefined}>
                      {setting.value ? setting.value : '(not set)'} {isSelected ? '[Enter to edit]' : ''}
                    </Text>
                  )
                ) : setting.type === 'enum' ? (
                  <Text color={isSelected ? 'blue' : undefined} dimColor={setting.disabled ? true : undefined}>
                    {setting.value}
                  </Text>
                ) : (
                  <Text color={isSelected ? 'blue' : undefined}>
                  </Text>
                )}
              </Box>
            </Box>
          )
        })}
      </Box>
      <Box marginLeft={3}>
        <Text dimColor>
          {editingString ? (
            <>Type to edit · Paste with terminal paste · Enter to save · Esc to cancel</>
          ) : exitState.pending ? (
            <>Press {exitState.keyName} again to exit</>
          ) : (
            <>↑/↓ to select · Enter/Space to change · Esc to close</>
          )}
        </Text>
      </Box>
    </>
  )
}
