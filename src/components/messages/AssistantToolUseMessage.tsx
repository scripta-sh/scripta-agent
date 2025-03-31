import { Box, Text } from 'ink'
import React from 'react'
import { logError } from '../../utils/log'
import { ToolUseBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { Tool } from '../../core/tools/types'
import { Cost } from '../Cost'
import { ToolUseLoader } from '../ToolUseLoader'
import { getTheme } from '../../utils/theme'
import { BLACK_CIRCLE } from '../../core/constants/figures'
import { ThinkTool } from '../../core/tools/agent'
import { AssistantThinkingMessage } from './AssistantThinkingMessage'
import { renderToolUseMessage } from 'cli/renderers/toolRenderers'

type Props = {
  param: ToolUseBlockParam
  costUSD: number
  durationMs: number
  addMargin: boolean
  tools: Tool[]
  debug: boolean
  verbose: boolean
  erroredToolUseIDs: Set<string>
  inProgressToolUseIDs: Set<string>
  unresolvedToolUseIDs: Set<string>
  shouldAnimate: boolean
  shouldShowDot: boolean
}

export function AssistantToolUseMessage({
  param,
  costUSD,
  durationMs,
  addMargin,
  tools,
  debug,
  verbose,
  erroredToolUseIDs,
  inProgressToolUseIDs,
  unresolvedToolUseIDs,
  shouldAnimate,
  shouldShowDot,
}: Props): React.ReactNode {
  const tool = tools.find(_ => _.name === param.name)
  if (!tool) {
    logError(`Tool ${param.name} not found`)
    return null
  }
  const isQueued =
    !inProgressToolUseIDs.has(param.id) && unresolvedToolUseIDs.has(param.id)
  // Keeping color undefined makes the OS use the default color regardless of appearance
  const color = isQueued ? getTheme().secondaryText : undefined

  // TODO: Avoid this special case
  if (tool.name === ThinkTool.name) {
    // params were already validated in query(), so this won't throw
    const { thought } = ThinkTool.inputSchema.parse(param.input)
    return (
      <AssistantThinkingMessage
        param={{ thinking: thought, signature: '', type: 'thinking' }}
        addMargin={addMargin}
      />
    )
  }

  const userFacingToolName = tool.userFacingName(param.input as never)
  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      marginTop={addMargin ? 1 : 0}
      width="100%"
    >
      <Box>
        <Box
          flexWrap="nowrap"
          minWidth={userFacingToolName.length + (shouldShowDot ? 2 : 0)}
        >
          {shouldShowDot &&
            (isQueued ? (
              <Box minWidth={2}>
                <Text color={color}>{BLACK_CIRCLE}</Text>
              </Box>
            ) : (
              <ToolUseLoader
                shouldAnimate={shouldAnimate}
                isUnresolved={unresolvedToolUseIDs.has(param.id)}
                isError={erroredToolUseIDs.has(param.id)}
              />
            ))}
          <Text color={color} bold={!isQueued}>
            {userFacingToolName}
          </Text>
        </Box>
        <Box flexWrap="nowrap">
          {Object.keys(param.input as { [key: string]: unknown }).length >
            0 && (
            <Text color={color}>
              (
              {renderToolUseMessage(tool.name, param.input, verbose)}
              )
            </Text>
          )}
          <Text color={color}>…</Text>
        </Box>
      </Box>
      <Cost costUSD={costUSD} durationMs={durationMs} debug={debug} />
    </Box>
  )
}
