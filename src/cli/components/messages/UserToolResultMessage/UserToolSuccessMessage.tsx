import { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { Box } from 'ink'
import * as React from 'react'
import { Tool } from '../../../Tool'
import { Message, UserMessage } from 'query'
import { useGetToolFromMessages } from './utils'
import { renderToolResultMessage } from 'cli/renderers/toolRenderers'

type Props = {
  param: ToolResultBlockParam
  message: UserMessage
  messages: Message[]
  verbose: boolean
  tools: Tool[]
  width: number | string
}

export function UserToolSuccessMessage({
  param,
  message,
  messages,
  tools,
  verbose,
  width,
}: Props): React.ReactNode {
  const { tool } = useGetToolFromMessages(param.tool_use_id, tools, messages)

  if (!tool) {
    // Handle case where tool might not be found (optional, for robustness)
    return <Box>Error: Tool not found for result.</Box>
  }

  // Call the new centralized renderer function
  return (
    // TODO: Distinguish UserMessage from UserToolResultMessage
    <Box flexDirection="column" width={width}>
      {renderToolResultMessage(tool.name, message.toolUseResult?.data, verbose)}
    </Box>
  )
}
