import type { TextBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { z } from 'zod'
import { BaseTool } from '../../base/BaseTool'
import { ToolUseContext } from '../../types'
import { ARCHITECT_SYSTEM_PROMPT, DESCRIPTION } from './prompt'

// Importing from other parts of the codebase
import { getContext } from '../../../../context'
import { Message, query } from '../../../../core/agent'
import { lastX } from '../../../../utils/generators'
import { createUserMessage } from '../../../../utils/messages'

// Tool names for filtering in tool context
const FS_EXPLORATION_TOOL_NAMES = [
  'Bash',
  'LS',
  'View',
  'Replace',
  'GlobTool',
  'GrepTool',
];

const inputSchema = z.strictObject({
  prompt: z
    .string()
    .describe('The technical request or coding task to analyze'),
  context: z
    .string()
    .describe('Optional context from previous conversation or system state')
    .optional(),
});

type ArchitectToolInput = z.infer<typeof inputSchema>;

export class CoreArchitectTool extends BaseTool {
  name = 'Architect';
  inputSchema = inputSchema;

  async description() {
    return DESCRIPTION;
  }

  async prompt() {
    return DESCRIPTION;
  }

  isReadOnly(): boolean {
    return true;
  }

  userFacingName() {
    return 'Architect';
  }

  async isEnabled() {
    return false;
  }

  needsPermissions(): boolean {
    return false;
  }

  async *call(
    { prompt, context }: ArchitectToolInput,
    toolUseContext: ToolUseContext
  ) {
    const content = context
      ? `<context>${context}</context>\n\n${prompt}`
      : prompt;

    const userMessage = createUserMessage(content);
    const messages: Message[] = [userMessage];

    // We only allow the file exploration tools to be used in the architect tool
    const allowedTools = (toolUseContext.options.tools ?? []).filter(tool =>
      FS_EXPLORATION_TOOL_NAMES.includes(tool.name)
    );

    const lastResponse = await lastX(
      query(
        messages,
        [ARCHITECT_SYSTEM_PROMPT],
        await getContext(),
        async (tool, input) => ({ result: true }), // Simple permission handler
        {
          ...toolUseContext,
          options: { ...toolUseContext.options, tools: allowedTools },
        },
      ),
    );

    if (lastResponse.type !== 'assistant') {
      throw new Error(`Invalid response from API`);
    }

    const data = lastResponse.message.content.filter(_ => _.type === 'text');
    yield {
      type: 'result',
      data,
      resultForAssistant: this.renderResultForAssistant(data),
    };
  }

  renderResultForAssistant(data: TextBlock[]) {
    return data;
  }
}