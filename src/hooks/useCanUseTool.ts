import { useCallback } from 'react'
import * as React from 'react'
import { hasPermissionsToUseTool } from '../permissions'
import { logEvent } from '../services/statsig'
import { BashTool, inputSchema as bashToolInputSchema } from '../core/tools/shell'
import { getCommandSubcommandPrefix } from '../utils/commands'
import { REJECT_MESSAGE } from '../utils/messages'
import type { Tool as ToolType } from '../core/tools'
import { PermissionHandlerContext } from '../core/permissions/IPermissionHandler'
import { AssistantMessage } from '../core/agent'
import { ToolUseConfirm } from '../components/permissions/PermissionRequest'
import { AbortError } from '../utils/errors'
import { logError } from '../utils/log'

type SetState<T> = React.Dispatch<React.SetStateAction<T>>

export type CanUseToolFn = (
  tool: ToolType,
  input: { [key: string]: unknown },
  context: PermissionHandlerContext,
  assistantMessage: AssistantMessage,
) => Promise<{ result: true } | { result: false; message: string }>

function useCanUseTool(
  setToolUseConfirm: SetState<ToolUseConfirm | null>,
): CanUseToolFn {
  return useCallback<CanUseToolFn>(
    async (tool, input, context, assistantMessage) => {
      return new Promise(resolve => {
        function logCancelledEvent() {
          logEvent('tengu_tool_use_cancelled', {
            messageID: assistantMessage.message.id,
            toolName: tool.name,
          })
        }

        function resolveWithCancelledAndAbortAllToolCalls() {
          resolve({
            result: false,
            message: REJECT_MESSAGE,
          })
          // Trigger a synthetic assistant message in query(), to cancel
          // any other pending tool uses and stop further requests to the
          // API and wait for user input.
          // context.abortController.abort() // <-- Can't abort via context anymore
          // Aborting needs to be handled by the caller based on the resolved promise
          // or by checking context.abortSignal elsewhere.
        }

        if (context.abortSignal.aborted) { // <-- Check context.abortSignal
          logCancelledEvent()
          resolveWithCancelledAndAbortAllToolCalls() // Resolve false, caller handles abort
          return
        }

        return hasPermissionsToUseTool(
          tool,
          input,
          context, // <-- Pass the correct context
          assistantMessage,
        )
          .then(async result => {
            // Has permissions to use tool, granted in config
            if (result.result) {
              logEvent('tengu_tool_use_granted_in_config', {
                messageID: assistantMessage.message.id,
                toolName: tool.name,
              })
              resolve({ result: true })
              return
            }

            const [description, commandPrefix] = await Promise.all([
              tool.description(input as never),
              tool.name === 'Bash'
                ? getCommandSubcommandPrefix(
                    bashToolInputSchema.parse(input).command,
                    context.abortSignal,
                  )
                : Promise.resolve(null),
            ])

            if (context.abortSignal.aborted) {
              logCancelledEvent()
              resolveWithCancelledAndAbortAllToolCalls()
              return
            }

            // Does not have permissions to use tool, ask the user
            setToolUseConfirm({
              assistantMessage,
              tool,
              description,
              input,
              commandPrefix,
              riskScore: null,
              onAbort() {
                logCancelledEvent()
                logEvent('tengu_tool_use_rejected_in_prompt', {
                  messageID: assistantMessage.message.id,
                  toolName: tool.name,
                })
                resolveWithCancelledAndAbortAllToolCalls()
              },
              onAllow(type) {
                if (type === 'permanent') {
                  logEvent('tengu_tool_use_granted_in_prompt_permanent', {
                    messageID: assistantMessage.message.id,
                    toolName: tool.name,
                  })
                } else {
                  logEvent('tengu_tool_use_granted_in_prompt_temporary', {
                    messageID: assistantMessage.message.id,
                    toolName: tool.name,
                  })
                }
                resolve({ result: true })
              },
              onReject() {
                logEvent('tengu_tool_use_rejected_in_prompt', {
                  messageID: assistantMessage.message.id,
                  toolName: tool.name,
                })
                resolveWithCancelledAndAbortAllToolCalls()
              },
            })
          })
          .catch(error => {
            if (error instanceof AbortError) {
              logCancelledEvent()
              resolveWithCancelledAndAbortAllToolCalls()
            } else {
              logError(error)
            }
          })
      })
    },
    [setToolUseConfirm],
  )
}

export default useCanUseTool
