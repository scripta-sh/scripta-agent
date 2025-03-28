/**
 * Core configuration for the Scripta-Agent API
 * This file provides configuration functions for the API implementation
 */

import { safeParseJSON } from '../utils/json'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { GLOBAL_CLAUDE_FILE } from '../utils/env'
import path from 'path'
import os from 'os'

// Default configuration
export const defaultConfig = {
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  apiKeySource: 'anthropic',
  model: 'claude-3-sonnet-20240229',
  requireApiKey: process.env.NODE_ENV !== 'development',
  defaultWorkingDirectory: process.cwd(),
  trustTools: [] as string[],
}

// Configuration type
export type Config = typeof defaultConfig

/**
 * Get the configuration from the global Claude file
 */
export function getConfig(): Config {
  try {
    if (!existsSync(GLOBAL_CLAUDE_FILE)) {
      return defaultConfig
    }

    const fileContent = readFileSync(GLOBAL_CLAUDE_FILE, 'utf-8')
    const parsedConfig = safeParseJSON(fileContent) || {}
    
    return {
      ...defaultConfig,
      ...parsedConfig,
    }
  } catch (error) {
    console.error('Error reading config:', error)
    return defaultConfig
  }
}

/**
 * Update the configuration file
 */
export function updateConfig(config: Partial<Config>): void {
  try {
    // Create the directory if it doesn't exist
    const dir = path.dirname(GLOBAL_CLAUDE_FILE)
    if (!existsSync(dir)) {
      const mkdirRecursive = (dirPath: string) => {
        if (existsSync(dirPath)) return
        mkdirRecursive(path.dirname(dirPath))
        writeFileSync(dirPath, '', { mode: 0o700 })
      }
      mkdirRecursive(dir)
    }

    // Read existing config
    const existingConfig = getConfig()
    
    // Merge with new config
    const newConfig = {
      ...existingConfig,
      ...config,
    }
    
    // Write back to file
    writeFileSync(GLOBAL_CLAUDE_FILE, JSON.stringify(newConfig, null, 2), 'utf-8')
  } catch (error) {
    console.error('Error updating config:', error)
    throw error
  }
}

/**
 * Validate the configuration
 */
export function validateConfig(config: Config = getConfig()): { 
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = []

  if (config.requireApiKey && !config.apiKey) {
    errors.push('API key is required')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Initialize the configuration directory
 */
export function initConfig(): void {
  if (!existsSync(GLOBAL_CLAUDE_FILE)) {
    updateConfig(defaultConfig)
  }
}