/**
 * Message processor for the Scripta-Agent API
 * Handles parsing and classifying different types of messages
 */

import { ExecutionContext } from './engine'

/**
 * Types of messages supported by the system
 */
export enum MessageType {
  TEXT = 'text',
  COMMAND = 'command',
  BASH = 'bash',
}

/**
 * Result of message processing
 */
export interface ProcessedMessage {
  type: MessageType;
  content: string;
}

/**
 * Process an incoming message to determine its type and content
 */
export async function processMessage(
  message: string,
  context: ExecutionContext
): Promise<ProcessedMessage> {
  // Strip leading/trailing whitespace
  const trimmedMessage = message.trim()
  
  // Check if this is a command (starts with /)
  if (trimmedMessage.startsWith('/')) {
    const commandName = trimmedMessage.split(' ')[0].substring(1).toLowerCase()
    
    // Check if it's a valid command
    if (context.commands[commandName]) {
      return {
        type: MessageType.COMMAND,
        content: trimmedMessage.substring(1), // Remove the leading /
      }
    }
  }
  
  // Check if this is a bash command (starts with !)
  if (trimmedMessage.startsWith('!')) {
    return {
      type: MessageType.BASH,
      content: trimmedMessage.substring(1).trim(), // Remove the leading !
    }
  }
  
  // Default to regular text message
  return {
    type: MessageType.TEXT,
    content: trimmedMessage,
  }
}
