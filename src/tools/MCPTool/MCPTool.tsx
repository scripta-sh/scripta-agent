import { Box, Text } from 'ink'
import * as React from 'react'
import { z } from 'zod'
import { FallbackToolUseRejectedMessage } from '../../components/FallbackToolUseRejectedMessage'
import { type Tool } from '../../Tool'
import { getTheme } from '../../utils/theme'
import { DESCRIPTION, PROMPT } from './prompt'
import { OutputLine } from '../BashTool/OutputLine'

// Allow any input object since MCP tools define their own schemas
const inputSchema = z.object({}).passthrough()

export const MCPTool = {
  async isEnabled() {
    return true
  },
  isReadOnly() {
    return false
  },
  // Overridden in mcpClient.ts
  name: 'mcp',
  // Overridden in mcpClient.ts
  async description() {
    return DESCRIPTION
  },
  // Overridden in mcpClient.ts
  async prompt() {
    return PROMPT
  },
  inputSchema,
  // Overridden in mcpClient.ts
  async *call() {
    yield {
      type: 'result',
      data: '',
      resultForAssistant: '',
    }
  },
  needsPermissions() {
    return true
  },
  // Overridden in mcpClient.ts
  userFacingName: () => 'mcp',
  renderResultForAssistant(content) {
    return content
  },
} satisfies Tool<typeof inputSchema, string>
