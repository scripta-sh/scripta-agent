import { Box, Text } from 'ink'
import React, { useMemo } from 'react'
import { Select } from '@inkjs/ui'
import { getTheme } from '../../../../utils/theme'
import {
  PermissionRequestTitle,
  textColorForRiskScore,
} from '../PermissionRequestTitle.js'
import { logUnaryEvent } from '../../../../utils/unaryLogging'
import { env } from '../../../../utils/env'
import {
  type PermissionRequestProps,
  type ToolUseConfirm,
} from '../PermissionRequest.js'
import chalk from 'chalk'
import {
  UnaryEvent,
  usePermissionRequestLogging,
} from '../../../../hooks/usePermissionRequestLogging.js'
import { CoreFileEditTool as FileEditTool } from '@core/tools/filesystem/FileEditTool/FileEditTool'
import { CoreFileWriteTool as FileWriteTool } from '@core/tools/filesystem/FileWriteTool/FileWriteTool'
import { CoreGrepTool as GrepTool } from '@core/tools/filesystem/GrepTool/GrepTool'
import { CoreGlobTool as GlobTool } from '@core/tools/filesystem/GlobTool/GlobTool'
import { CoreLSTool as LSTool } from '@core/tools/filesystem/LSTool/LSTool'
import { CoreFileReadTool as FileReadTool } from '@core/tools/filesystem/FileReadTool/FileReadTool'
import { CoreNotebookEditTool as NotebookEditTool } from '@core/tools/notebook/NotebookEditTool/NotebookEditTool'
import { CoreNotebookReadTool as NotebookReadTool } from '@core/tools/notebook/NotebookReadTool/NotebookReadTool'
import { FallbackPermissionRequest } from '../FallbackPermissionRequest'
import {
  grantWritePermissionForOriginalDir,
  pathInOriginalCwd,
  toAbsolutePath,
} from '../../../../utils/permissions/filesystem.js'
import { getCwd } from '../../../../utils/state'
import { renderToolUseMessage } from '../../../renderers/toolRenderers'

function pathArgNameForToolUse(toolUseConfirm: ToolUseConfirm): string | null {
  switch (toolUseConfirm.tool) {
    case FileWriteTool:
    case FileEditTool:
    case FileReadTool: {
      return 'file_path'
    }
    case GlobTool:
    case GrepTool:
    case LSTool: {
      return 'path'
    }
    case NotebookEditTool:
    case NotebookReadTool: {
      return 'notebook_path'
    }
  }
  return null
}

function isMultiFile(toolUseConfirm: ToolUseConfirm): boolean {
  switch (toolUseConfirm.tool) {
    case GlobTool:
    case GrepTool:
    case LSTool: {
      return true
    }
  }
  return false
}

function pathFromToolUse(toolUseConfirm: ToolUseConfirm): string | null {
  const pathArgName = pathArgNameForToolUse(toolUseConfirm)
  const input = toolUseConfirm.input
  if (pathArgName && pathArgName in input) {
    if (typeof input[pathArgName] === 'string') {
      return toAbsolutePath(input[pathArgName])
    } else {
      return toAbsolutePath(getCwd())
    }
  }
  return null
}

export function FilesystemPermissionRequest({
  toolUseConfirm,
  onDone,
  verbose,
}: PermissionRequestProps): React.ReactNode {
  const path = pathFromToolUse(toolUseConfirm)
  if (!path) {
    // Fall back to generic permission request if no path is found
    return (
      <FallbackPermissionRequest
        toolUseConfirm={toolUseConfirm}
        onDone={onDone}
        verbose={verbose}
      />
    )
  }
  return (
    <FilesystemPermissionRequestImpl
      toolUseConfirm={toolUseConfirm}
      path={path}
      onDone={onDone}
      verbose={verbose}
    />
  )
}

function getDontAskAgainOptions(toolUseConfirm: ToolUseConfirm, path: string) {
  if (toolUseConfirm.tool.isReadOnly()) {
    // "Always allow" is not an option for read-only tools,
    // because they always have write permission in the project directory.
    return []
  }
  // Only show don't ask again option for edits in original working directory
  return pathInOriginalCwd(path)
    ? [
        {
          label: "Yes, and don't ask again for file edits this session",
          value: 'yes-dont-ask-again',
        },
      ]
    : []
}

type Props = {
  toolUseConfirm: ToolUseConfirm
  path: string
  onDone(): void
  verbose: boolean
}

function FilesystemPermissionRequestImpl({
  toolUseConfirm,
  path,
  onDone,
  verbose,
}: Props): React.ReactNode {
  const userFacingName = toolUseConfirm.tool.userFacingName(
    toolUseConfirm.input as never,
  )

  const userFacingReadOrWrite = toolUseConfirm.tool.isReadOnly()
    ? 'Read'
    : 'Edit'
  const title = `${userFacingReadOrWrite} ${isMultiFile(toolUseConfirm) ? 'files' : 'file'}`

  const unaryEvent = useMemo<UnaryEvent>(
    () => ({
      completion_type: 'tool_use_single',
      language_name: 'none',
    }),
    [],
  )

  usePermissionRequestLogging(toolUseConfirm, unaryEvent)

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={textColorForRiskScore(toolUseConfirm.riskScore)}
      marginTop={1}
      paddingLeft={1}
      paddingRight={1}
      paddingBottom={1}
    >
      <PermissionRequestTitle
        title={title}
        riskScore={toolUseConfirm.riskScore}
      />
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text>
          {userFacingName}(
          {renderToolUseMessage(
            toolUseConfirm.tool.name,
            toolUseConfirm.input,
            verbose
          )}
          )
        </Text>
      </Box>

      <Box flexDirection="column">
        <Text>Do you want to proceed?</Text>
        <Select
          options={[
            {
              label: 'Yes',
              value: 'yes',
            },
            ...getDontAskAgainOptions(toolUseConfirm, path),
            {
              label: `No, and provide instructions (${chalk.bold.hex(getTheme().warning)('esc')})`,
              value: 'no',
            },
          ]}
          onChange={newValue => {
            switch (newValue) {
              case 'yes':
                logUnaryEvent({
                  completion_type: 'tool_use_single',
                  event: 'accept',
                  metadata: {
                    language_name: 'none',
                    message_id: toolUseConfirm.assistantMessage.message.id,
                    platform: env.platform,
                  },
                })
                toolUseConfirm.onAllow('once')
                onDone()
                break
              case 'yes-dont-ask-again':
                logUnaryEvent({
                  completion_type: 'tool_use_single',
                  event: 'accept',
                  metadata: {
                    language_name: 'none',
                    message_id: toolUseConfirm.assistantMessage.message.id,
                    platform: env.platform,
                  },
                })
                grantWritePermissionForOriginalDir()
                toolUseConfirm.onAllow('permanent')
                onDone()
                break
              case 'no':
                logUnaryEvent({
                  completion_type: 'tool_use_single',
                  event: 'reject',
                  metadata: {
                    language_name: 'none',
                    message_id: toolUseConfirm.assistantMessage.message.id,
                    platform: env.platform,
                  },
                })
                toolUseConfirm.onReject()
                onDone()
                break
            }
          }}
        />
      </Box>
    </Box>
  )
}
