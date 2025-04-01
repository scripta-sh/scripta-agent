import * as React from 'react'
import { Tool } from 'Tool'
import { Message } from 'query'
import { FallbackToolUseRejectedMessage } from '../../FallbackToolUseRejectedMessage'
import { useGetToolFromMessages } from './utils'
import { useTerminalSize } from 'hooks/useTerminalSize'
import { renderToolUseRejectedMessage } from 'cli/renderers/toolRenderers'

type Props = {
  toolUseID: string
  messages: Message[]
  tools: Tool[]
  verbose: boolean
}

export function UserToolRejectMessage({
  toolUseID,
  tools,
  messages,
  verbose,
}: Props): React.ReactNode {
  const { columns } = useTerminalSize()
  const { tool, toolUse } = useGetToolFromMessages(toolUseID, tools, messages)

  if (!tool || !toolUse) {
    return <FallbackToolUseRejectedMessage />
  }

  const input = tool.inputSchema.safeParse(toolUse.input)
  if (input.success) {
    return renderToolUseRejectedMessage(tool.name, input.data, {
      columns,
      verbose,
    })
  }
  return <FallbackToolUseRejectedMessage />
}
