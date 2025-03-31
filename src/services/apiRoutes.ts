import { Router } from 'express'
import { z } from 'zod'
import { executeQuery, ExecutionContext } from '../core/engine'
import { getAvailableTools } from '../core/tools'
import { authenticateRequest } from './auth'
import { validateRequest } from './validation'
import { logEvent } from './statsig'
import { logError } from '../utils/log'
import { getConfig, updateConfig, defaultConfig } from '../core/config'

// Session storage (in-memory for now, will be replaced with a database in Phase 2)
export const sessions: Map<string, ExecutionContext> = new Map()

// Create a router
const router = Router()

// Schema for setup configuration
const setupSchema = z.object({
  apiKey: z.string().optional(),
  apiKeySource: z.enum(['anthropic', 'azure', 'aws', 'vertex']).optional(),
  model: z.string().optional(),
  requireApiKey: z.boolean().optional(),
  defaultWorkingDirectory: z.string().optional(),
  trustTools: z.array(z.string()).optional(),
})

/**
 * API endpoint for sending a message
 */
router.post('/message', 
  authenticateRequest,
  validateRequest,
  async (req, res) => {
    try {
      const { input, sessionId, contextParams } = req.body
      
      // Get or create the session
      const context = await getOrCreateSession(
        sessionId,
        contextParams?.workingDirectory
      )
      
      // Execute the query
      const result = await executeQuery(input, context)
      
      // Update the session if needed
      if (sessionId) {
        updateSession(sessionId, {
          messages: [...context.messages, result.response],
        })
      }
      
      // Log the event
      logEvent('api_message_processed', {
        sessionId,
        success: !result.error,
        error: result.error?.message,
      })
      
      // Return the response
      return res.json({
        response: result.response,
        toolUses: result.toolUses,
      })
    } catch (error) {
      logError(error)
      
      return res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
)

/**
 * API endpoint for session management
 */
router.get('/sessions/:sessionId', 
  authenticateRequest,
  async (req, res) => {
    const { sessionId } = req.params
    
    // Check if the session exists
    const session = sessions.get(sessionId)
    if (!session) {
      return res.status(404).json({
        error: 'Session not found',
      })
    }
    
    // Return the session data (excluding sensitive info)
    return res.json({
      sessionId,
      messageCount: session.messages.length,
      workingDirectory: session.workingDirectory,
    })
  }
)

/**
 * API endpoint for listing all available sessions
 */
router.get('/sessions', 
  authenticateRequest,
  async (req, res) => {
    // Return all session IDs and basic metadata
    const sessionData = Array.from(sessions.entries()).map(([id, session]) => ({
      sessionId: id,
      messageCount: session.messages.length,
      workingDirectory: session.workingDirectory,
    }))
    
    return res.json({
      sessions: sessionData,
    })
  }
)

/**
 * API endpoint for listing available tools
 */
router.get('/tools', 
  authenticateRequest,
  (req, res) => {
    const tools = getAvailableTools({
      isMCP: false,
      dangerouslySkipPermissions: false,
    })
    
    return res.json({
      tools: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        schema: tool.inputJSONSchema,
      })),
    })
  }
)

/**
 * API endpoint for setting up configuration
 * This allows the API to work independently of CLI setup
 */
router.post('/setup', 
  async (req, res) => {
    try {
      // Validate the request
      const parseResult = setupSchema.safeParse(req.body)
      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Invalid setup configuration',
          details: parseResult.error.format(),
        })
      }
      
      // Get the current config
      const config = getConfig()
      
      // Update config with new values
      const newConfig = {
        ...config,
        ...parseResult.data,
      }
      
      // Save the updated config
      updateConfig(newConfig)
      
      // Return success response
      return res.json({
        success: true,
        message: 'Configuration updated successfully',
        config: {
          ...newConfig,
          // Hide sensitive data
          apiKey: newConfig.apiKey ? '********' : undefined,
        },
      })
    } catch (error) {
      logError(error)
      
      return res.status(500).json({
        error: 'Failed to update configuration',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
)

/**
 * API endpoint for getting current configuration
 */
router.get('/setup', 
  async (req, res) => {
    try {
      // Get the current config
      const config = getConfig()
      
      // Return the config (excluding sensitive data)
      return res.json({
        config: {
          ...config,
          apiKey: config.apiKey ? '********' : undefined,
        },
        isConfigured: Boolean(config.apiKey),
      })
    } catch (error) {
      logError(error)
      
      return res.status(500).json({
        error: 'Failed to get configuration',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
)

/**
 * API endpoint for validating configuration
 */
router.post('/setup/validate', 
  async (req, res) => {
    try {
      // Get the current config
      const config = getConfig()
      
      // Check if API key is set
      if (!config.apiKey) {
        return res.status(400).json({
          success: false,
          message: 'API key is not configured',
          validationErrors: ['apiKey: API key is required'],
        })
      }
      
      // TODO: Implement actual validation of the API key by making a test request
      // For now, we just check if it exists
      
      return res.json({
        success: true,
        message: 'Configuration is valid',
      })
    } catch (error) {
      logError(error)
      
      return res.status(500).json({
        success: false,
        message: 'Validation failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
)

// Export the session functions for use in other files
export { getOrCreateSession, updateSession, createNewSession }

// Export the router for use in the main API file
export default router

/* Helper Functions */

/**
 * Load a session from storage or create a new one
 */
async function getOrCreateSession(sessionId?: string, workingDirectory?: string): Promise<ExecutionContext> {
  // If no session ID is provided, create a transient session
  if (!sessionId) {
    return createNewSession(workingDirectory)
  }
  
  // Check if the session exists
  const existingSession = sessions.get(sessionId)
  if (existingSession) {
    return existingSession
  }
  
  // Create a new session if it doesn't exist
  const newSession = await createNewSession(workingDirectory)
  newSession.sessionId = sessionId
  sessions.set(sessionId, newSession)
  
  return newSession
}

/**
 * Create a new execution context
 */
async function createNewSession(workingDirectory?: string): Promise<ExecutionContext> {
  // Import these dynamically to avoid circular dependencies
  const { getSystemPrompt } = await import('../core/constants/prompts')
  const { getEnvInfo } = await import('../utils/env')
  const { getCommandRegistry } = await import('../commands')
  const { getCwd } = await import('../utils/state') 
  
  // Get system prompt and context
  const systemPrompt = await getSystemPrompt()
  const envInfo = await getEnvInfo()
  
  // Create the context with default values
  return {
    workingDirectory: workingDirectory || getCwd(),
    tools: getAvailableTools({
      isMCP: false,
      dangerouslySkipPermissions: false,
    }),
    messages: [],
    systemPrompt,
    additionalContext: {
      env: envInfo,
    },
    commands: getCommandRegistry(),
  }
}

/**
 * Update a session with new messages
 */
function updateSession(sessionId: string, update: Partial<ExecutionContext>): void {
  const session = sessions.get(sessionId)
  if (!session) {
    return
  }
  
  // Update the session with new data
  Object.assign(session, update)
  sessions.set(sessionId, session)
}