import OpenAI from 'openai';
import { ContentBlock } from '@anthropic-ai/sdk/resources/messages/messages';
import { UserMessage, AssistantMessage } from '../agent';
import { nanoid } from 'nanoid';
import { createComponentLogger } from '../../utils/log';

// Create a logger for this component
const logger = createComponentLogger('MessageConversion');

/**
 * Convert Anthropic-style messages to OpenAI format
 */
export function convertAnthropicToOpenAI(
  messages: (UserMessage | AssistantMessage)[]
): (OpenAI.ChatCompletionMessageParam | OpenAI.ChatCompletionToolMessageParam)[] {
  const openaiMessages: (OpenAI.ChatCompletionMessageParam | OpenAI.ChatCompletionToolMessageParam)[] = [];
  const toolResults: Record<string, OpenAI.ChatCompletionToolMessageParam> = {};

  for (const message of messages) {
    let contentBlocks = [];
    if (typeof message.message.content === 'string') {
      contentBlocks = [{
        type: 'text',
        text: message.message.content,
      }];
    } else if (!Array.isArray(message.message.content)) {
      contentBlocks = [message.message.content];
    } else {
      contentBlocks = message.message.content;
    }

    for (const block of contentBlocks) {
      if (block.type === 'text') {
        openaiMessages.push({
          role: message.message.role,
          content: block.text,
        });
      } else if (block.type === 'tool_use') {
        openaiMessages.push({
          role: 'assistant',
          content: undefined,
          tool_calls: [{
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
            id: block.id,
          }],
        });
      } else if (block.type === 'tool_result') {
        // Extract the string content from the Anthropic block format
        // OpenAI expects a plain string for tool role content.
        let resultString = '';
        if (Array.isArray(block.content) && block.content.length > 0 && block.content[0]?.type === 'text') {
          resultString = block.content[0].text;
        } else if (typeof block.content === 'string') {
          // Handle cases where content might already be a string (less likely now, but safe)
          resultString = block.content;
        } else {
          // Log a warning if the format is unexpected and attempt to stringify
          logger.warn(`Unexpected tool_result content format for tool_use_id ${block.tool_use_id}:`, block.content);
          try {
            resultString = JSON.stringify(block.content);
          } catch {
            resultString = '[Error: Could not stringify tool result content]';
          }
        }

        toolResults[block.tool_use_id] = {
          role: 'tool',
          content: resultString, // Assign the extracted string
          tool_call_id: block.tool_use_id,
        };
      }
    }
  }

  const finalMessages: (OpenAI.ChatCompletionMessageParam | OpenAI.ChatCompletionToolMessageParam)[] = [];
  
  for (const message of openaiMessages) {
    finalMessages.push(message);
    
    if ('tool_calls' in message && message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        if (toolResults[toolCall.id]) {
          finalMessages.push(toolResults[toolCall.id]);
        }
      }
    }
  }
  
  return finalMessages;
}

/**
 * Convert OpenAI-style response to Anthropic format
 */
export function convertOpenAIToAnthropic(
  response: OpenAI.ChatCompletion
): { role: string; content: ContentBlock[]; stop_reason: string; type: string; usage: any } {
  const contentBlocks: ContentBlock[] = [];
  const message = response.choices?.[0]?.message;
  
  if (!message) {
    logger.warn('Received empty or invalid response from OpenAI API');
    return {
      role: 'assistant',
      content: [],
      stop_reason: response.choices?.[0]?.finish_reason || 'stop',
      type: 'message',
      usage: response.usage,
    };
  }
  
  // Handle tool calls
  if (message?.tool_calls) {
    for (const toolCall of message.tool_calls) {
      const tool = toolCall.function;
      const toolName = tool.name;
      let toolArgs = {};
      
      try {
        toolArgs = JSON.parse(tool.arguments);
      } catch (e) {
        logger.warn(`Failed to parse tool arguments: ${tool.arguments}`);
      }

      contentBlocks.push({
        type: 'tool_use',
        input: toolArgs,
        name: toolName,
        id: toolCall.id?.length > 0 ? toolCall.id : nanoid(),
      });
    }
  }

  // Handle reasoning/thinking (from Claude-style providers)
  if (message.reasoning) {
    contentBlocks.push({
      type: 'thinking',
      thinking: message?.reasoning,
      signature: '',
    });
  }

  // Handle reasoning_content (specific to DeepSeek API)
  if (message.reasoning_content) {
    contentBlocks.push({
      type: 'thinking',
      thinking: message?.reasoning_content,
      signature: '',
    });
  }

  // Handle regular text content
  if (message.content) {
    contentBlocks.push({
      type: 'text',
      text: message?.content,
      citations: [],
    });
  }

  return {
    role: 'assistant',
    content: contentBlocks,
    stop_reason: response.choices?.[0]?.finish_reason || 'stop',
    type: 'message',
    usage: response.usage,
  };
}