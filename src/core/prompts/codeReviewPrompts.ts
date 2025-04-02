import type { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { BashTool } from '../tools/shell/index.js'; // Import directly from shell index

export function generateReviewPrompt(args: string): MessageParam[] {
  return [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `
You are an expert code reviewer. Follow these steps:

1. If no PR number is provided in the args, use ${BashTool.name}("gh pr list") to show open PRs
2. If a PR number is provided, use ${BashTool.name}("gh pr view <number>") to get PR details
3. Use ${BashTool.name}("gh pr diff <number>") to get the diff
4. Analyze the changes and provide a thorough code review that includes:
    - Overview of what the PR does
    - Analysis of code quality and style
    - Specific suggestions for improvements
    - Any potential issues or risks

Keep your review concise but thorough. Focus on:
- Code correctness
- Following project conventions
- Performance implications
- Test coverage
- Security considerations

Format your review with clear sections and bullet points.

PR number: ${args}
`,
        },
      ],
    },
  ];
}

export function generatePrCommentsPrompt(args: string): MessageParam[] {
  return [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `You are an AI assistant integrated into a git-based version control system. Your task is to fetch and display comments from a GitHub pull request.

Follow these steps:

1. Use \`gh pr view --json number,headRepository\` to get the PR number and repository info
2. Use \`gh api /repos/{owner}/{repo}/issues/{number}/comments\` to get PR-level comments
3. Use \`gh api /repos/{owner}/{repo}/pulls/{number}/comments\` to get review comments. Pay particular attention to the following fields: \`body\`, \`diff_hunk\`, \`path\`, \`line\`, etc. If the comment references some code, consider fetching it using eg \`gh api /repos/{owner}/{repo}/contents/{path}?ref={branch} | jq .content -r | base64 -d\`
4. Parse and format all comments in a readable way
5. Return ONLY the formatted comments, with no additional text

Format the comments as:

## Comments

[For each comment thread:]
- @author file.ts#line:
  \`\`\`diff
  [diff_hunk from the API response]
  \`\`\`
  > quoted comment text
  
  [any replies indented]

If there are no comments, return "No comments found."

Remember:
1. Only show the actual comments, no explanatory text
2. Include both PR-level and code review comments
3. Preserve the threading/nesting of comment replies
4. Show the file and line number context for code review comments
5. Use jq to parse the JSON responses from the GitHub API

${args ? 'Additional user input: ' + args : ''}
`,
        },
      ],
    },
  ];
} 