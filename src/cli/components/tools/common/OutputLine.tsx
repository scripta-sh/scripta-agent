import { Box, Text } from 'ink'
import * as React from 'react'
import { getTheme } from '../../../../utils/theme'
import chalk from 'chalk'

// Define constant here rather than importing from BashTool
const MAX_RENDERED_LINES = 20;

function renderTruncatedContent(content: string, totalLines: number): string {
  const allLines = content.split('\n')
  if (allLines.length <= MAX_RENDERED_LINES) {
    return allLines.join('\n')
  }
  const firstHalf = Math.floor(MAX_RENDERED_LINES / 2)
  const secondHalf = MAX_RENDERED_LINES - firstHalf
  return [
    ...allLines.slice(0, firstHalf),
    chalk.grey(`... (+${totalLines - MAX_RENDERED_LINES} lines)`),
    ...allLines.slice(-secondHalf),
  ].join('\n')
}

export interface OutputLineProps {
  content: string;
  lines: number;
  verbose: boolean;
  isError?: boolean;
}

export function OutputLine({
  content,
  lines,
  verbose,
  isError,
}: OutputLineProps) {
  return (
    <Box justifyContent="space-between" width="100%">
      <Box flexDirection="row">
        <Text>&nbsp;&nbsp;⎿ &nbsp;</Text>
        <Box flexDirection="column">
          <Text color={isError ? getTheme().error : undefined}>
            {verbose
              ? content.trim()
              : renderTruncatedContent(content.trim(), lines)}
          </Text>
        </Box>
      </Box>
    </Box>
  )
}