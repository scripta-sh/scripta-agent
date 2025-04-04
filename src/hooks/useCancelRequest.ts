import { useInput } from 'ink'
import { ToolUseConfirm } from '../cli/components/permissions/PermissionRequest'
import { logEvent } from '../services/statsig'
import { BinaryFeedbackContext } from '../cli/screens/REPL'
import type { SetToolJSXFn } from '../types/tool-ui'

export function useCancelRequest(
  setToolJSX: SetToolJSXFn,
  setToolUseConfirm: (toolUseConfirm: ToolUseConfirm | null) => void,
  setBinaryFeedbackContext: (bfContext: BinaryFeedbackContext | null) => void,
  onCancel: () => void,
  isLoading: boolean,
  isMessageSelectorVisible: boolean,
  abortSignal?: AbortSignal,
) {
  useInput((_, key) => {
    if (!key.escape) {
      return
    }
    if (abortSignal?.aborted) {
      return
    }
    if (!abortSignal) {
      return
    }
    if (!isLoading) {
      return
    }
    if (isMessageSelectorVisible) {
      // Esc closes the message selector
      return
    }
    logEvent('tengu_cancel', {})
    setToolJSX(null)
    setToolUseConfirm(null)
    setBinaryFeedbackContext(null)
    onCancel()
  })
}
