import { safeParseJSON } from './json'
import { logError } from './log'
import { llmService } from '../core/providers'
import crypto from 'crypto'
import { getSmallModel } from './model'

export function setTerminalTitle(title: string): void {
  if (process.platform === 'win32') {
    process.title = title ? `✳ ${title}` : title
  } else {
    process.stdout.write(`\x1b]0;${title ? `✳ ${title}` : ''}\x07`)
  }
}

export async function updateTerminalTitle(message: string): Promise<void> {
  try {
    const systemPrompt = [
      "Analyze if this message indicates a new conversation topic. If it does, extract a 2-3 word title that captures the new topic. Format your response as a JSON object with two fields: 'isNewTopic' (boolean) and 'title' (string, or null if isNewTopic is false). Only include these fields, no other text.",
    ];
    
    const userMessage = {
      type: 'user' as const,
      message: {
        content: message,
        role: 'user' as const,
        id: Date.now().toString(),
        type: 'message' as const
      },
      uuid: crypto.randomUUID()
    };
    
    const smallModelName = getSmallModel();
    
    const result = await llmService.query(
      [userMessage], 
      systemPrompt, 
      1000, // Small token limit for efficiency
      [], 
      new AbortController().signal,
      {
        model: smallModelName,
      }
    );

    const content = Array.isArray(result.message.content)
      ? result.message.content
        .filter(_ => _.type === 'text')
        .map(_ => _.text)
        .join('')
      : typeof result.message.content === 'string'
        ? result.message.content
        : '';

    const response = safeParseJSON(content)
    if (
      response &&
      typeof response === 'object' &&
      'isNewTopic' in response &&
      'title' in response
    ) {
      if (response.isNewTopic && response.title) {
        setTerminalTitle(response.title as string)
      }
    }
  } catch (error) {
    logError(error)
  }
}

export function clearTerminal(): Promise<void> {
  return new Promise(resolve => {
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H', () => {
      resolve()
    })
  })
}
