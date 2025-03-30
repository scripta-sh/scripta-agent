import * as React from 'react';
import { Box, Text } from 'ink';
import { EOL } from 'os';
import { extname, relative } from 'path';
import { FallbackToolUseRejectedMessage } from '../../components/FallbackToolUseRejectedMessage';
import { HighlightedCode } from '../../components/HighlightedCode';
import { FileEditToolUpdatedMessage } from '../../components/FileEditToolUpdatedMessage';
import { StructuredDiff } from '../../components/StructuredDiff';
import { Cost } from '../../components/Cost';
import { getTheme } from '../../utils/theme';
import { getCwd } from '../../utils/state';
import { intersperse } from '../../utils/array';
import { applyMarkdown } from '../../utils/markdown';
import { Hunk } from 'diff';
import { OutputLine } from '../../tools/BashTool/OutputLine'; // Keep relative path for now

// TODO: Define proper types for the 'data' parameter for each tool's output
// TODO: Define proper types for the 'input' parameter for each tool's input

const MAX_LINES_TO_RENDER = 3; // From FileReadTool

// --- Rendering Tool Use Messages ---

export function renderToolUseMessage(toolName: string, input: any, verbose: boolean): React.ReactNode {
  switch (toolName) {
    case 'View': // FileReadTool
      const { file_path, ...rest } = input;
      const entries = [
        ['file_path', verbose ? file_path : relative(getCwd(), file_path)],
        ...Object.entries(rest),
      ];
      return entries
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(', ');
    case 'Bash':
      let command = input.command;
      // Clean up HEREDOC
      if (command.includes("\"$(cat <<'EOF'")) {
        const match = command.match(
          /^(.*?)"?\$\(cat <<'EOF'\n([\s\S]*?)\n\s*EOF\n\s*\)"(.*)$/,
        );
        if (match && match[1] && match[2]) {
          const prefix = match[1];
          const content = match[2];
          const suffix = match[3] || '';
          command = `${prefix.trim()} "${content.trim()}"${suffix.trim()}`;
        }
      }
      return command;
    case 'Edit': // FileEditTool
    case 'Replace': // FileWriteTool
      return `file_path: ${verbose ? input.file_path : relative(getCwd(), input.file_path)}`;
    case 'Glob': // GlobTool (using TOOL_NAME_FOR_PROMPT which might be 'Glob')
    case 'Grep': // GrepTool (using TOOL_NAME_FOR_PROMPT which might be 'Grep')
      const absolutePath = input.path
        ? input.path.startsWith('/') // Simple check for absolute path
          ? input.path
          : `${getCwd()}/${input.path}` // Assuming resolve logic, might need refinement
        : undefined;
      const relativePath = absolutePath
        ? relative(getCwd(), absolutePath)
        : undefined;
      let msg = `pattern: "${input.pattern}"`;
      if (relativePath || verbose) {
        msg += `, path: "${verbose ? absolutePath : relativePath}"`;
      }
      if (toolName === 'Grep' && input.include) {
         msg += `, include: "${input.include}"`;
      }
      return msg;
    case 'LS': // lsTool
      const lsAbsolutePath = input.path
        ? input.path.startsWith('/')
          ? input.path
          : `${getCwd()}/${input.path}` // Assuming resolve logic
        : undefined;
      const lsRelativePath = lsAbsolutePath ? relative(getCwd(), lsAbsolutePath) : '.';
      return `path: "${verbose ? input.path : lsRelativePath}"`;
    case 'MemoryRead':
    case 'MemoryWrite':
    case 'Architect': // ArchitectTool
    case 'mcp': // MCPTool
       return Object.entries(input)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(', ');
    case 'Task': // AgentTool
      const lines = input.prompt.split(EOL);
      return applyMarkdown(!verbose && lines.length > 1 ? lines[0] + '…' : input.prompt);
    case 'Think': // ThinkTool - special cased in AssistantToolUseMessage
      return input.thought;
    case 'StickerRequest': // StickerRequestTool
        return ''; // Explicitly empty as per original tool
    case 'ReadNotebook': // NotebookReadTool
       return `notebook_path: ${verbose ? input.notebook_path : relative(getCwd(), input.notebook_path)}`;
    case 'NotebookEditCell': // NotebookEditTool
        return `notebook_path: ${verbose ? input.notebook_path : relative(getCwd(), input.notebook_path)}, cell: ${input.cell_number}, content: ${input.new_source.slice(0, 30)}…, cell_type: ${input.cell_type}, edit_mode: ${input.edit_mode ?? 'replace'}`;

    default:
      // Fallback for tools not explicitly handled yet
      try {
        return JSON.stringify(input);
      } catch (e) {
        return `[Input: ${toolName}]`;
      }
  }
}

// --- Rendering Tool Result Messages ---

export function renderToolResultMessage(toolName: string, data: any, verbose: boolean): React.ReactNode {
  // Note: Need to check the 'type' field within data for some tools (e.g., FileRead, FileWrite)
  switch (toolName) {
    case 'View': // FileReadTool
      if (!data) return null;
      switch (data.type) {
        case 'image':
          return (
            <Box justifyContent="space-between" overflowX="hidden" width="100%">
              <Box flexDirection="row">
                <Text>&nbsp;&nbsp;⎿ &nbsp;</Text>
                <Text>Read image</Text>
              </Box>
            </Box>
          );
        case 'text': {
          const { filePath, content, numLines } = data.file;
          const contentWithFallback = content || '(No content)';
          return (
            <Box justifyContent="space-between" overflowX="hidden" width="100%">
              <Box flexDirection="row">
                <Text>&nbsp;&nbsp;⎿ &nbsp;</Text>
                <Box flexDirection="column">
                  <HighlightedCode
                    code={
                      verbose
                        ? contentWithFallback
                        : contentWithFallback
                            .split('\n')
                            .slice(0, MAX_LINES_TO_RENDER)
                            .filter(_ => _.trim() !== '')
                            .join('\n')
                    }
                    language={extname(filePath).slice(1)}
                  />
                  {!verbose && numLines > MAX_LINES_TO_RENDER && (
                    <Text color={getTheme().secondaryText}>
                      ... (+{numLines - MAX_LINES_TO_RENDER} lines)
                    </Text>
                  )}
                </Box>
              </Box>
            </Box>
          );
        }
        default:
             return <Text>Unknown FileRead result type: {data.type}</Text>;
      }

    case 'Bash': // BashTool
      // Assumes data structure { stdout, stderr, stdoutLines, stderrLines, interrupted }
      // The original tool used a separate component `BashToolResultMessage` which likely handled this.
      // Replicating basic structure here. Needs refinement based on BashToolResultMessage component.
      if (!data) return <Text>Bash result empty.</Text>
      return (
         <Box flexDirection="column">
           {data.stdout && <OutputLine content={data.stdout} lines={data.stdoutLines} verbose={verbose} />}
           {data.stderr && <OutputLine content={data.stderr} lines={data.stderrLines} verbose={verbose} isError={true} />}
           {data.interrupted && <Text color="yellow">Command Interrupted</Text>}
         </Box>
       );

    case 'Edit': // FileEditTool
       // Assumes data structure { filePath, structuredPatch }
       if (!data) return <Text>FileEdit result empty.</Text>
      return (
        <FileEditToolUpdatedMessage
          filePath={data.filePath}
          structuredPatch={data.structuredPatch}
          verbose={verbose}
        />
      );

    case 'Replace': // FileWriteTool
        // Assumes data structure { filePath, content, structuredPatch, type: 'create' | 'update' }
        if (!data) return <Text>FileWrite result empty.</Text>
        switch (data.type) {
          case 'create': {
            const contentWithFallback = data.content || '(No content)';
            const numLines = data.content.split(EOL).length;
            return (
              <Box flexDirection="column">
                <Text>
                  {'  '}⎿ Wrote {numLines} lines to{' '}
                  <Text bold>
                    {verbose ? data.filePath : relative(getCwd(), data.filePath)}
                  </Text>
                </Text>
                <Box flexDirection="column" paddingLeft={5}>
                  <HighlightedCode
                    code={
                      verbose
                        ? contentWithFallback
                        : contentWithFallback
                            .split('\n')
                            .slice(0, MAX_LINES_TO_RENDER) // Using constant from FileReadTool
                            .filter(_ => _.trim() !== '')
                            .join('\n')
                    }
                    language={extname(data.filePath).slice(1)}
                  />
                  {!verbose && numLines > MAX_LINES_TO_RENDER && (
                    <Text color={getTheme().secondaryText}>
                      ... (+{numLines - MAX_LINES_TO_RENDER} lines)
                    </Text>
                  )}
                </Box>
              </Box>
            );
          }
          case 'update':
             if (!data.structuredPatch) return <Text>FileWrite update result structure invalid.</Text>
            return (
              <FileEditToolUpdatedMessage // Reusing component from FileEdit
                filePath={data.filePath}
                structuredPatch={data.structuredPatch}
                verbose={verbose}
              />
            );
          default:
             return <Text>Unknown FileWrite result type: {data.type}</Text>;
        }

    case 'Glob': // GlobTool
        // Assumes data structure { durationMs, numFiles }
        if (typeof data === 'string') { // Handle potential old string format
            try { data = JSON.parse(data); } catch { return <Text>Invalid Glob result format.</Text>}
        }
         if (!data || typeof data.numFiles === 'undefined') return <Text>Glob result empty or invalid.</Text>
        return (
          <Box justifyContent="space-between" width="100%">
            <Box flexDirection="row">
              <Text>&nbsp;&nbsp;⎿ &nbsp;Found </Text>
              <Text bold>{data.numFiles} </Text>
              <Text>
                {data.numFiles === 0 || data.numFiles > 1 ? 'files' : 'file'}
              </Text>
            </Box>
            <Cost costUSD={0} durationMs={data.durationMs} debug={false} />
          </Box>
        );

    case 'Grep': // GrepTool
        // Assumes data structure { durationMs, numFiles }
        if (typeof data === 'string') { // Handle potential old string format
             try { data = JSON.parse(data); } catch { return <Text>Invalid Grep result format.</Text>}
        }
         if (!data || typeof data.numFiles === 'undefined') return <Text>Grep result empty or invalid.</Text>
        return (
          <Box justifyContent="space-between" width="100%">
            <Box flexDirection="row">
              <Text>&nbsp;&nbsp;⎿ &nbsp;Found </Text>
              <Text bold>{data.numFiles} </Text>
              <Text>
                {data.numFiles === 0 || data.numFiles > 1 ? 'files' : 'file'}
              </Text>
            </Box>
            <Cost costUSD={0} durationMs={data.durationMs} debug={false} />
          </Box>
        );

     case 'LS': // lsTool
        // Assumes data is a string (the formatted tree)
        if (typeof data !== 'string') {
          return <Text>LS result invalid.</Text>;
        }
        // Removing TRUNCATED_MESSAGE logic here as it was complex and maybe better handled upstream
        const result = data;
        if (!result) {
          return null;
        }
        return (
          <Box justifyContent="space-between" width="100%">
            <Box>
              <Text>&nbsp;&nbsp;⎿ &nbsp;</Text>
              <Box flexDirection="column" paddingLeft={0}>
                {result
                  .split('\n')
                  .filter(_ => _.trim() !== '')
                  .slice(0, verbose ? undefined : 4) // Using magic number 4 from original tool
                  .map((_, i) => (
                    <React.Fragment key={i}>
                      <Text>{_}</Text>
                    </React.Fragment>
                  ))}
                {!verbose && result.split('\n').length > 4 && (
                  <Text color={getTheme().secondaryText}>
                    ... (+{result.split('\n').length - 4} items)
                  </Text>
                )}
              </Box>
            </Box>
          </Box>
        );

     case 'MemoryRead': // MemoryReadTool
        // Assumes data { content: string }
         if (!data || typeof data.content === 'undefined') return <Text>MemoryRead result empty or invalid.</Text>
        return (
          <Box justifyContent="space-between" overflowX="hidden" width="100%">
            <Box flexDirection="row">
              <Text>&nbsp;&nbsp;⎿ &nbsp;</Text>
              <Text>{data.content}</Text> {/* Simple rendering for now */}
            </Box>
          </Box>
        );

      case 'MemoryWrite': // MemoryWriteTool
        // Data was just 'Saved' string in original tool call
        return (
          <Box justifyContent="space-between" overflowX="hidden" width="100%">
            <Box flexDirection="row">
              <Text>{'  '}⎿ Updated memory</Text>
            </Box>
          </Box>
        );

     case 'ReadNotebook': // NotebookReadTool
         // Assumes data is NotebookCellSource[] - Using any as temporary workaround
         const cells = data as any[]; // Use any[] instead of NotebookCellSource[]
         if (!cells || !Array.isArray(cells) || cells.length < 1 || !cells[0]) {
             return <Text>No cells found in notebook</Text>;
         }
         return <Text>Read {cells.length} cells</Text>;

     case 'NotebookEditCell': // NotebookEditTool
         // Assumes data { cell_number, new_source, language, error }
         if (!data) return <Text>NotebookEdit result empty.</Text>
        if (data.error) {
          return (
            <Box flexDirection="column">
              <Text color="red">{data.error}</Text>
            </Box>
          );
        }
        return (
          <Box flexDirection="column">
            <Text>Updated cell {data.cell_number}:</Text>
            <Box marginLeft={2}>
              <HighlightedCode code={data.new_source} language={data.language} />
            </Box>
          </Box>
        );

      case 'Architect': // ArchitectTool
         // Assumes data is TextBlock[]
         if (!data || !Array.isArray(data)) return <Text>Architect result invalid.</Text>
        return (
          <Box flexDirection="column" gap={1}>
            <HighlightedCode
              code={data.map(_ => _.text).join('\n')}
              language="markdown"
            />
          </Box>
        );

      case 'mcp': // MCPTool
          // Complex rendering logic from original tool, simplified here
          if (Array.isArray(data)) {
            return (
              <Box flexDirection="column">
                {data.map((item, i) => {
                  if (item.type === 'image') {
                    return (
                      <Box key={i} flexDirection="row">
                        <Text>&nbsp;&nbsp;⎿ &nbsp;</Text>
                        <Text>[Image]</Text>
                      </Box>
                    );
                  }
                  const lines = item.text.split('\n').length;
                  return (
                    <React.Fragment key={i}>
                      <OutputLine content={item.text} lines={lines} verbose={verbose} />
                    </React.Fragment>
                  );
                })}
              </Box>
            );
          }
          if (!data) {
            return (
              <Box flexDirection="row">
                <Text>&nbsp;&nbsp;⎿ &nbsp;</Text>
                <Text color={getTheme().secondaryText}>(No content)</Text>
              </Box>
            );
          }
          const lines = data.split('\n').length;
          return <OutputLine content={data} lines={lines} verbose={verbose} />;

       // Tools with no specific result message rendering in the original code:
       case 'Think': // Special cased elsewhere
       case 'Task': // AgentTool - yielded progress messages, final result was just text blocks
       case 'StickerRequest': // Showed nothing on success in original logic
         return null; // Or potentially a generic success message?

    default:
      // Fallback for unhandled tools
      return <Text>&nbsp;&nbsp;⎿ Result for {toolName} (Raw: {JSON.stringify(data)})</Text>;
  }
}


// --- Rendering Tool Rejection Messages ---

export function renderToolUseRejectedMessage(toolName: string, input: any, context: { columns: number, verbose: boolean }): React.ReactNode {
    const { columns, verbose } = context;
    switch (toolName) {
        case 'Edit': // FileEditTool
            try {
              // Attempting to replicate original logic - needs applyEdit and Hunk type
              // const { patch } = applyEdit(input.file_path, input.old_string, input.new_string);
              // Placeholder:
              const patch: Hunk[] = []; // Need to import Hunk and potentially applyEdit
              return (
                <Box flexDirection="column">
                  <Text>
                    {'  '}⎿{' '}
                    <Text color={getTheme().error}>
                      User rejected {input.old_string === '' ? 'write' : 'update'} to{' '}
                    </Text>
                    <Text bold>
                      {verbose ? input.file_path : relative(getCwd(), input.file_path)}
                    </Text>
                  </Text>
                  {intersperse(
                    patch.map((p: Hunk) => ( // Need Hunk type
                      <Box flexDirection="column" paddingLeft={5} key={p.newStart}>
                        <StructuredDiff patch={p} dim={true} width={columns - 12} />
                      </Box>
                    )),
                    i => (
                      <Box paddingLeft={5} key={`ellipsis-${i}`}>
                        <Text color={getTheme().secondaryText}>...</Text>
                      </Box>
                    ),
                  )}
                   {/* <Text color={getTheme().secondaryText}>  (Diff rendering skipped in refactor)</Text> */}
                </Box>
              );
            } catch (e) {
              console.error("Error rendering FileEdit rejection:", e);
              return (
                <Box flexDirection="column">
                  <Text>{'  '}⎿ (No changes)</Text>
                </Box>
              );
            }

        case 'Replace': // FileWriteTool
             try {
                // Attempting to replicate - needs getPatch, Hunk
                 const fullFilePath = input.file_path.startsWith('/') ? input.file_path : `${getCwd()}/${input.file_path}`; // Simple absolute path logic
                // const oldFileExists = existsSync(fullFilePath); // Requires fs access
                // const enc = oldFileExists ? detectFileEncoding(fullFilePath) : 'utf-8'; // Requires utils
                // const oldContent = oldFileExists ? readFileSync(fullFilePath, enc) : null; // Requires fs
                 const type = 'update'; // Assuming update for now
                // const patch = getPatch({ filePath: input.file_path, fileContents: oldContent ?? '', oldStr: oldContent ?? '', newStr: input.content }); // Requires utils
                 const patch: Hunk[] = []; // Placeholder
                return (
                    <Box flexDirection="column">
                        <Text>
                            {'  '}⎿{' '}
                            <Text color={getTheme().error}>
                                User rejected {type === 'update' ? 'update' : 'write'} to{' '}
                            </Text>
                            <Text bold>
                                {verbose ? input.file_path : relative(getCwd(), input.file_path)}
                            </Text>
                        </Text>
                        {intersperse(
                            patch.map((p: Hunk) => ( // Need Hunk
                                <Box flexDirection="column" paddingLeft={5} key={p.newStart}>
                                    <StructuredDiff patch={p} dim={true} width={columns - 12} />
                                </Box>
                            )),
                             i => (
                                <Box paddingLeft={5} key={`ellipsis-${i}`}>
                                    <Text color={getTheme().secondaryText}>...</Text>
                                </Box>
                            ),
                        )}
                        {/* <Text color={getTheme().secondaryText}>  (Diff rendering skipped in refactor)</Text> */}
                    </Box>
                );
            } catch (e) {
                console.error("Error rendering FileWrite rejection:", e);
                return (
                    <Box flexDirection="column">
                        <Text>{'  '}⎿ (No changes)</Text>
                    </Box>
                );
            }

        case 'StickerRequest': // StickerRequestTool
            return (
                <Text>
                &nbsp;&nbsp;⎿ &nbsp;
                <Text color={getTheme().error}>No (Sticker request cancelled)</Text>
                </Text>
            );

         case 'Think': // ThinkTool
            return (
                 <Box> {/* Original used MessageResponse, using Box for now */}
                    <Text color={getTheme().error}>Thought cancelled</Text>
                 </Box>
            );

        // Default fallback for other tools
        case 'View':
        case 'Bash':
        case 'Glob':
        case 'Grep':
        case 'LS':
        case 'MemoryRead':
        case 'MemoryWrite':
        case 'ReadNotebook':
        case 'NotebookEditCell':
        case 'Task': // AgentTool
        case 'Architect':
        case 'mcp':
        default:
            return <FallbackToolUseRejectedMessage />;
    }
} 