import * as React from 'react'
// Replace with core BashTool
import { Box, Text } from 'ink'
import { OutputLine } from '../tools/common/OutputLine'
import { getTheme } from '../../utils/theme'
import { extractTag } from '../../utils/messages'

export function AssistantBashOutputMessage({
  content,
  verbose,
}: {
  content: string
  verbose?: boolean
}): React.ReactNode {
  const stdout = extractTag(content, 'bash-stdout') ?? ''
  const stderr = extractTag(content, 'bash-stderr') ?? ''
  const stdoutLines = stdout.split('\n').length
  const stderrLines = stderr.split('\n').length
  const theme = getTheme();
  const hasError = stderr && stderr.trim() !== '';
    
  return (
    <Box flexDirection="column">
      {stdout && (
        <Box flexDirection="column">
          <OutputLine content={stdout} lines={stdoutLines} verbose={!!verbose} />
        </Box>
      )}
      
      {hasError && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={theme.error}>stderr:</Text>
          <OutputLine content={stderr} lines={stderrLines} verbose={!!verbose} isError={true} />
        </Box>
      )}
    </Box>
  )
}
