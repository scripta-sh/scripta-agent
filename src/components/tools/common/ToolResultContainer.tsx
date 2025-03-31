import * as React from 'react';
import { Box, Text } from 'ink';
import { getTheme } from '../../../utils/theme';

export interface ToolResultContainerProps {
  title: React.ReactNode;
  children: React.ReactNode;
  type?: 'success' | 'warning' | 'error' | 'info';
}

export function ToolResultContainer({ 
  title, 
  children, 
  type = 'success' 
}: ToolResultContainerProps) {
  const theme = getTheme();
  let borderColor: string;
  
  switch (type) {
    case 'success':
      borderColor = theme.success;
      break;
    case 'warning':
      borderColor = theme.warning;
      break;
    case 'error':
      borderColor = theme.error;
      break;
    case 'info':
    default:
      borderColor = theme.primary;
  }
  
  return (
    <Box 
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      marginTop={1}
      paddingLeft={1}
      paddingRight={1}
      paddingBottom={1}
      width="100%"
    >
      <Box marginBottom={1}>
        <Text bold color={borderColor}>{title}</Text>
      </Box>
      {children}
    </Box>
  );
}