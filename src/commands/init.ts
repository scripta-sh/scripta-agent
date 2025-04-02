import type { Command } from '../commands'
import { markProjectOnboardingComplete } from '../ProjectOnboarding'
import { generateInitPrompt } from '../core/prompts/projectPrompts'
import { PROJECT_FILE } from '../core/constants/product'
const command = {
  type: 'prompt',
  name: 'init',
  description: `Initialize a new ${PROJECT_FILE} file with codebase documentation`,
  isEnabled: true,
  isHidden: false,
  progressMessage: 'analyzing your codebase',
  userFacingName() {
    return 'init'
  },
  async getPromptForCommand(_args: string) {
    // Mark onboarding as complete when init command is run
    markProjectOnboardingComplete()
    // Call the extracted function to get the prompt
    return generateInitPrompt();
  },
} satisfies Command

export default command
