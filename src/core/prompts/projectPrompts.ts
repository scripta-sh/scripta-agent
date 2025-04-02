import type { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { PROJECT_FILE } from '@core/constants/product';

export function generateInitPrompt(): MessageParam[] {
  return [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Please analyze this codebase and create a ${PROJECT_FILE} file containing:
1. Build/lint/test commands - especially for running a single test
2. Code style guidelines including imports, formatting, types, naming conventions, error handling, etc.

The file you create will be given to agentic coding agents (such as yourself) that operate in this repository. Make it about 20 lines long.
If there's already a ${PROJECT_FILE}, improve it.
If there are Cursor rules (in .cursor/rules/ or .cursorrules) or Copilot rules (in .github/copilot-instructions.md), make sure to include them.`,
        },
      ],
    },
  ];
} 