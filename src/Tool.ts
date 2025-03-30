import { z } from 'zod'
import * as React from 'react'
import { ToolUseContext } from './ToolUseContext'

// Export ToolUseContext if it's defined here or re-export if imported
export { ToolUseContext }

export interface Tool {
  name: string
  description?: string | ((input: any) => Promise<string>)
  inputSchema: z.ZodObject<any>
  inputJSONSchema?: Record<string, unknown>
  prompt: (options: { dangerouslySkipPermissions: boolean }) => Promise<string>
  userFacingName: (input: any) => string | React.ReactNode
  isEnabled?: () => Promise<boolean>
  isReadOnly?: () => boolean
  needsPermissions?: (input: any) => boolean
  validateInput?: (
    input: any,
    context: ToolUseContext,
  ) => Promise<{ result: boolean; message?: string; meta?: Record<string, any> }>
  call: (
    input: any,
    context: ToolUseContext,
  ) => AsyncGenerator<{
    type: 'progress' | 'result'
    content?: any
    data?: any
    resultForAssistant?: any
    normalizedMessages?: any[]
    tools?: Tool[]
  }>
  renderResultForAssistant?: (data: any) => any
}

// Re-export ToolUseContext if needed, or define it here if it's simple
// export { ToolUseContext } 