import * as React from 'react';
import { Box, Text } from 'ink';
import { ToolRenderer } from '../ToolRenderer';
import { ToolResultContainer } from '../common/ToolResultContainer';
import { OutputLine } from '../common/OutputLine';
import { HighlightedCode } from '../../HighlightedCode';
import { getTheme } from '../../../../utils/theme';

/**
 * Types specific to the Bash tool
 */
interface BashToolInput {
  command: string;
  timeout?: number;
}

interface BashToolOutput {
  stdout: string;
  stderr: string;
  stdoutLines: number;
  stderrLines: number;
  interrupted?: boolean;
}

/**
 * Renderer for the Bash tool
 */
export const BashToolRenderer: ToolRenderer<BashToolInput, BashToolOutput> = {
  renderToolUse: (input, { verbose }) => {
    let command = input.command;
    
    // Clean up HEREDOC for display
    if (command.includes("\"$(cat <<'EOF'")) {
      const match = command.match(
        /^(.*?)"?\$\(cat <<'EOF'\n([\s\S]*?)\n\s*EOF\n\s*\)"(.*)$/,
      );
      if (match && match[1] && match[2]) {
        const prefix = match[1];
        const content = match[2];
        const suffix = match[3] || '';
        command = `${prefix.trim()} "${content.trim()}"${suffix.trim()}`;
      }
    }
    
    return command;
  },

  renderToolResult: (data, { verbose }) => {
    if (!data) return <Text>Bash result empty.</Text>;
    
    const theme = getTheme();
    
    // Determine result type based on stderr and exit code
    const hasError = data.stderr && data.stderr.trim() !== '';
    const wasInterrupted = data.interrupted;
    const resultType = wasInterrupted ? 'warning' : (hasError ? 'error' : 'success');
    
    return (
      <ToolResultContainer 
        title={wasInterrupted ? "Command Interrupted" : (hasError ? "Command Completed with Errors" : "Command Executed")}
        type={resultType}
      >
        <Box flexDirection="column">
          {data.stdout && (
            <Box flexDirection="column">
              <OutputLine content={data.stdout} lines={data.stdoutLines} verbose={verbose} />
            </Box>
          )}
          
          {hasError && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold color={theme.error}>stderr:</Text>
              <OutputLine content={data.stderr} lines={data.stderrLines} verbose={verbose} isError={true} />
            </Box>
          )}
          
          {wasInterrupted && (
            <Text color={theme.warning}>The command was interrupted before completion</Text>
          )}
        </Box>
      </ToolResultContainer>
    );
  },

  renderToolRejected: (input, context) => {
    const theme = getTheme();
    
    return (
      <ToolResultContainer title="Command Execution Rejected" type="error">
        <Box flexDirection="column">
          <Text color={theme.error}>User rejected executing this command:</Text>
          <Box marginTop={1} marginLeft={2}>
            <HighlightedCode code={input.command} language="bash" />
          </Box>
        </Box>
      </ToolResultContainer>
    );
  }
};