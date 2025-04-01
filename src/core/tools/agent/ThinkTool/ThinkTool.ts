import { z } from 'zod'
import { BaseTool } from '../../base/BaseTool'
import { ToolUseContext } from '../../types'
import { DESCRIPTION, PROMPT } from './prompt'

// Utility imports - will be updated later
import { checkGate, logEvent } from '../../../../services/statsig'
import { USE_BEDROCK, USE_VERTEX } from '../../../../utils/model'

const thinkToolSchema = z.object({
  thought: z.string().describe('Your thoughts.'),
})

type ThinkToolInput = z.infer<typeof thinkToolSchema>;
type ThinkToolOutput = { thought: string };

export class CoreThinkTool extends BaseTool {
  name = 'Think';
  inputSchema = thinkToolSchema;

  async description() {
    return DESCRIPTION;
  }

  async prompt() {
    return PROMPT;
  }

  userFacingName() {
    return 'Think';
  }

  async isEnabled() {
    return Boolean(process.env.THINK_TOOL) && (await checkGate('tengu_think_tool'));
  }

  isReadOnly(): boolean {
    return true;
  }

  needsPermissions(): boolean {
    return false;
  }

  async *call(input: ThinkToolInput, { messageId, abortSignal }: ToolUseContext) {
    logEvent('tengu_thinking', {
      messageId,
      thoughtLength: input.thought.length.toString(),
      method: 'tool',
      provider: USE_BEDROCK ? 'bedrock' : USE_VERTEX ? 'vertex' : '1p',
    });

    yield {
      type: 'result',
      resultForAssistant: 'Your thought has been logged.',
      data: { thought: input.thought },
    };
  }

  renderResultForAssistant(): string {
    return 'Your thought has been logged.';
  }
}