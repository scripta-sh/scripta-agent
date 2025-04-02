import { Command } from '../commands'
import { BashTool } from '../core/tools'
import { generateReviewPrompt } from '../core/prompts/codeReviewPrompts'

export default {
  type: 'prompt',
  name: 'review',
  description: 'Review a pull request',
  isEnabled: true,
  isHidden: false,
  progressMessage: 'reviewing pull request',
  userFacingName() {
    return 'review'
  },
  async getPromptForCommand(args) {
    return generateReviewPrompt(args)
  },
} satisfies Command
