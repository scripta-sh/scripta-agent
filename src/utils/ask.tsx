import { last } from 'lodash-es'
import { Command } from '../commands'
import { getSystemPrompt } from '../core/constants/prompts'
import { getContext } from '../context'
import { getTotalCost } from '../cost-tracker'
import { Message, query } from '../core/agent'
import { CanUseToolFn } from '../hooks/useCanUseTool'
import type { Tool } from '../core/tools/types'
import { getSlowAndCapableModel } from '../utils/model'
import { setCwd } from './state'
import { getMessagesPath, overwriteLog } from './log'
import { createUserMessage } from './messages'

type Props = {
  commands: Command[]
  dangerouslySkipPermissions?: boolean
  hasPermissionsToUseTool: CanUseToolFn
  messageLogName: string
  prompt: string
  cwd: string
  tools: Tool[]
  verbose?: boolean
}

// Sends a single prompt to the Claude API and returns the response.
// Assumes that claude is being used non-interactively -- will not
// ask the user for permissions or further input.
export async function ask({
  commands,
  dangerouslySkipPermissions,
  hasPermissionsToUseTool,
  messageLogName,
  prompt,
  cwd,
  tools,
  verbose = false,
}: Props): Promise<{
  resultText: string
  totalCost: number
  messageHistoryFile: string
}> {
  await setCwd(cwd)
  const message = createUserMessage(prompt)
  const messages: Message[] = [message]

  const [systemPrompt, context, model] = await Promise.all([
    getSystemPrompt(),
    getContext(),
    getSlowAndCapableModel(),
  ])

  for await (const m of query(
    messages,
    systemPrompt,
    context,
    hasPermissionsToUseTool,
    {
      options: {
        commands,
        tools,
        verbose,
        dangerouslySkipPermissions,
        slowAndCapableModel: model,
        forkNumber: 0,
        messageLogName: 'unused',
        maxThinkingTokens: 0,
      },
      abortController: new AbortController(),
      messageId: undefined,
      readFileTimestamps: {},
    },
  )) {
    messages.push(m)
  }

  const result = last(messages)
  if (!result || result.type !== 'assistant') {
    throw new Error('Expected content to be an assistant message')
  }
  if (result.message.content[0]?.type !== 'text') {
    throw new Error(
      `Expected first content item to be text, but got ${JSON.stringify(
        result.message.content[0],
        null,
        2,
      )}`,
    )
  }

  // Write log that can be retrieved with `claude log`
  const messageHistoryFile = getMessagesPath(messageLogName, 0, 0)
  overwriteLog(messageHistoryFile, messages)

  return {
    resultText: result.message.content[0].text,
    totalCost: getTotalCost(),
    messageHistoryFile,
  }
}
