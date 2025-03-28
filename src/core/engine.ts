/**
 * Core execution engine for Scripta-Agent
 * This module is responsible for executing queries and managing execution context
 */

import { Tool } from '../Tool'
import { logEvent } from '../services/statsig'
import { processMessage, MessageType } from './messageProcessor'
import { executeTool } from './toolExecutor'
import { getSystemPrompt } from '../constants/prompts'
import { getAvailableTools } from './tools'
// Using direct environment variables instead of config utility
import { getConfig } from './config'
import { getCwd } from '../utils/state'
import { getEnvInfo } from '../utils/env'
import { v4 as uuidv4 } from 'uuid'
import { querySonnet, queryHaiku } from '../services/claude'
import type { Commands } from '../commands'

/**
 * Response from Claude API
 */
interface ApiResponse {
  type: string;
  message?: {
    content: Array<{
      type: string;
      text?: string;
    }>;
  };
}

/**
 * Tool use result tracking
 */
interface ToolUse {
  tool: string;
  input: any;
  output: any;
  timestamp: number;
}

/**
 * Result of query execution
 */
export interface QueryResult {
  response: ApiResponse;
  toolUses: ToolUse[];
  error?: Error;
}

/**
 * Context for query execution
 */
export interface ExecutionContext {
  sessionId?: string;
  workingDirectory: string;
  tools: Tool[];
  messages: ApiResponse[];
  systemPrompt: string;
  additionalContext: {
    env: any;
    // Add more context as needed
  };
  commands: Commands;
}

/**
 * Execute a query with the given context
 */
export async function executeQuery(
  input: string,
  context: ExecutionContext
): Promise<QueryResult> {
  try {
    // Track start time
    const startTime = Date.now()

    // Process the message to determine its type and content
    const { type, content } = await processMessage(input, context)
    
    // Track tool uses
    const toolUses: ToolUse[] = []

    // Handle different message types
    let response: ApiResponse
    switch (type) {
      case MessageType.COMMAND:
        // Execute command and handle result
        // Not implemented in Phase 1
        response = {
          type: 'text',
          message: {
            content: [{
              type: 'text',
              text: 'Commands not yet implemented in API mode',
            }],
          },
        }
        break

      case MessageType.BASH:
        // Execute bash command and handle result
        const bashTool = context.tools.find(tool => tool.name === 'BashTool')
        if (bashTool) {
          const result = await executeTool(bashTool, { command: content }, context)
          toolUses.push({
            tool: 'BashTool',
            input: { command: content },
            output: result,
            timestamp: Date.now(),
          })
          response = {
            type: 'text',
            message: {
              content: [{
                type: 'text',
                text: String(result),
              }],
            },
          }
        } else {
          throw new Error('BashTool not available')
        }
        break

      case MessageType.TEXT:
      default:
        // Regular text message - forward to Claude API
        try {
          // Get API key and model from config
          const config = getConfig()
          const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY
          const model = config.model || 'claude-3-sonnet-20240229'
          
          if (!apiKey) {
            throw new Error('No API key found. Please set an API key in the configuration or environment.')
          }
          
          // Create a basic conversation history
          const messages = [
            {
              role: 'user',
              content: content
            }
          ]
          
          // Use the appropriate model based on config
          let apiResponse
          if (model.includes('haiku')) {
            apiResponse = await queryHaiku({
              apiKey,
              messages,
              systemPrompt: context.systemPrompt,
              maxTokens: 1000
            })
          } else {
            apiResponse = await querySonnet(
              apiKey,
              messages,
              context.systemPrompt,
              undefined, // fileUploads
              { maxTokens: 1000 }
            )
          }
          
          // Format the response
          response = {
            type: 'text',
            message: {
              content: [{
                type: 'text',
                text: apiResponse.content[0].text,
              }],
            },
          }
          
          // Log successful API call
          logEvent('api_claude_call', {
            success: 'true',
            model,
            messageLength: content.length.toString(),
          })
        } catch (apiError) {
          console.error('Claude API error:', apiError)
          logEvent('api_claude_call', { success: 'false' })
          
          // Return a friendly error message
          response = {
            type: 'error',
            message: {
              content: [{
                type: 'text',
                text: 'Sorry, I encountered an error connecting to Claude. Please check your API key and try again.',
              }],
            },
          }
        }
        break
    }

    // Track execution time
    const endTime = Date.now()
    const duration = endTime - startTime

    // Log the execution
    logEvent('api_query_executed', {
      duration: duration.toString(),
      messageType: type,
      toolCount: toolUses.length.toString(),
    })

    return {
      response,
      toolUses,
    }
  } catch (error) {
    // Log the error
    console.error('Query execution error:', error)
    
    // Return error result
    return {
      response: {
        type: 'error',
        message: {
          content: [{
            type: 'text',
            text: error instanceof Error ? error.message : String(error),
          }],
        },
      },
      toolUses: [],
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}
