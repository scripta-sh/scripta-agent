import { type Tool } from '../../../tools/interfaces/Tool'
import { ToolCategories, getToolsByCategory, getToolsByFilter } from '../../registry'

// Recursive import using relative references for forward compatibility
const BashToolName = 'Bash'
const FileWriteToolName = 'Replace'
const FileEditToolName = 'Edit'
const NotebookEditToolName = 'NotebookEditCell'
const FileReadToolName = 'View'
const GlobToolName = 'GlobTool'
const AgentToolName = 'dispatch_agent'

export async function getAgentTools(
  dangerouslySkipPermissions: boolean,
): Promise<Tool[]> {
  // No recursive agents, yet..
  if (dangerouslySkipPermissions) {
    return getToolsByFilter(tool => tool.name !== AgentToolName);
  } else {
    return getToolsByFilter(tool => 
      tool.name !== AgentToolName && 
      (tool.isReadOnly?.() || false)
    );
  }
}

export async function getPrompt(
  dangerouslySkipPermissions: boolean,
): Promise<string> {
  const tools = await getAgentTools(dangerouslySkipPermissions);
  const toolNames = tools.map(_ => _.name).join(', ');
  return `Launch a new agent that has access to the following tools: ${toolNames}. When you are searching for a keyword or file and are not confident that you will find the right match on the first try, use the Agent tool to perform the search for you. For example:

- If you are searching for a keyword like "config" or "logger", the Agent tool is appropriate
- If you want to read a specific file path, use the ${FileReadToolName} or ${GlobToolName} tool instead of the Agent tool, to find the match more quickly
- If you are searching for a specific class definition like "class Foo", use the ${GlobToolName} tool instead, to find the match more quickly

Usage notes:
1. Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses
2. When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.
3. Each agent invocation is stateless. You will not be able to send additional messages to the agent, nor will the agent be able to communicate with you outside of its final report. Therefore, your prompt should contain a highly detailed task description for the agent to perform autonomously and you should specify exactly what information the agent should return back to you in its final and only message to you.
4. The agent's outputs should generally be trusted${
    dangerouslySkipPermissions
      ? ''
      : `
5. IMPORTANT: The agent can not use ${BashToolName}, ${FileWriteToolName}, ${FileEditToolName}, ${NotebookEditToolName}, so can not modify files. If you want to use these tools, use them directly instead of going through the agent.`
  }`
}