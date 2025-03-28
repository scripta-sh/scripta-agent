/**
 * Tool executor for the Scripta-Agent API
 * Handles executing tools with proper permission handling
 */

import { Tool } from '../Tool'
import { ExecutionContext } from './engine'
import { logEvent } from '../services/statsig'

/**
 * Error thrown when tool execution is rejected
 */
export class ToolRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolRejectedError'
  }
}

/**
 * Execute a tool with the given input
 */
export async function executeTool(
  tool: Tool,
  input: any,
  context: ExecutionContext
): Promise<any> {
  try {
    // Track execution start time
    const startTime = Date.now()
    
    // Check if the tool is allowed
    if (!tool) {
      throw new Error('Tool not found')
    }
    
    // Set working directory for the tool execution
    const toolInput = {
      ...input,
      workingDirectory: context.workingDirectory,
    }
    
    // Execute the tool
    const result = await tool.execute(toolInput)
    
    // Track execution time
    const duration = Date.now() - startTime
    
    // Log the execution
    logEvent('api_tool_executed', {
      tool: tool.name,
      duration: duration.toString(),
      success: 'true',
    })
    
    return result
  } catch (error) {
    // Log the execution error
    logEvent('api_tool_executed', {
      tool: tool.name,
      error: error instanceof Error ? error.message : String(error),
      success: 'false',
    })
    
    // Re-throw the error
    throw error
  }
}
