import { Command } from '../commands.js'
import { generatePrCommentsPrompt } from '../core/prompts/codeReviewPrompts.js'

export default {
  type: 'prompt',
  name: 'pr-comments',
  description: 'Get comments from a GitHub pull request',
  progressMessage: 'fetching PR comments',
  isEnabled: true,
  isHidden: false,
  userFacingName() {
    return 'pr-comments'
  },
  async getPromptForCommand(args: string) {
    return generatePrCommentsPrompt(args)
  },
} satisfies Command
