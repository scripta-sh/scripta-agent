import * as React from 'react';
import { Text } from 'ink';
import { ToolRenderer } from '../ToolRenderer';
import { ToolResultContainer } from '../common/ToolResultContainer';
import { getTheme } from '../../../utils/theme';

/**
 * Default implementation of ToolRenderer for any unhandled tools
 */
export const DefaultToolRenderer: ToolRenderer = {
  renderToolUse: (input, { verbose }) => {
    try {
      return JSON.stringify(input);
    } catch (e) {
      return `[Input data]`;
    }
  },

  renderToolResult: (data, { verbose }) => {
    if (!data) return null;
    
    return (
      <ToolResultContainer title="Tool Result" type="info">
        <Text>
          {typeof data === 'string' 
            ? data 
            : (typeof data === 'object' 
                ? JSON.stringify(data, null, 2) 
                : String(data))}
        </Text>
      </ToolResultContainer>
    );
  },

  renderToolRejected: (input, context) => {
    const theme = getTheme();
    
    return (
      <ToolResultContainer title="Operation Rejected" type="error">
        <Text color={theme.error}>User rejected this operation.</Text>
      </ToolResultContainer>
    );
  }
};