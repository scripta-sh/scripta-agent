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
import { OutputLine } from '../../tools/BashTool/OutputLine';
import { applyEdit } from '../../tools/FileEditTool/utils';
import { getPatch } from '../../utils/diff';
import { existsSync, readFileSync } from 'fs';
import { detectFileEncoding } from '../../utils/file';

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

// Common styling for tool results
function ToolResultContainer({ title, children, type = 'success' }: { title: React.ReactNode, children: React.ReactNode, type?: 'success' | 'warning' | 'error' | 'info' }) {
  const theme = getTheme();
  let borderColor: string;
  
  switch (type) {
    case 'success':
      borderColor = theme.success;
      break;
    case 'warning':
      borderColor = theme.warning;
      break;
    case 'error':
      borderColor = theme.error;
      break;
    case 'info':
    default:
      borderColor = theme.primary;
  }
  
  return (
    <Box 
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      marginTop={1}
      paddingLeft={1}
      paddingRight={1}
      paddingBottom={1}
      width="100%"
    >
      <Box marginBottom={1}>
        <Text bold color={borderColor}>{title}</Text>
      </Box>
      {children}
    </Box>
  );
}

export function renderToolResultMessage(toolName: string, data: any, verbose: boolean): React.ReactNode {
  // Get terminal dimensions for consistent formatting
  const columns = process.stdout.columns || 80;
  const theme = getTheme();
  
  switch (toolName) {
    case 'View': // FileReadTool
      if (!data) return null;
      switch (data.type) {
        case 'image':
          return (
            <ToolResultContainer title="Image Viewed">
              <Text>Successfully viewed image at:</Text>
              <Text bold>{verbose ? data.file?.filePath : relative(getCwd(), data.file?.filePath || "")}</Text>
            </ToolResultContainer>
          );
        case 'text': {
          const { filePath, content, numLines } = data.file;
          const contentWithFallback = content || '(No content)';
          const fileExt = extname(filePath).slice(1);
          const language = fileExt || 'text';
          
          return (
            <ToolResultContainer title={`File Content: ${verbose ? filePath : relative(getCwd(), filePath)}`}>
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
                  language={language}
                />
                {!verbose && numLines > MAX_LINES_TO_RENDER && (
                  <Text color={theme.secondaryText}>
                    ... (+{numLines - MAX_LINES_TO_RENDER} more lines)
                  </Text>
                )}
              </Box>
            </ToolResultContainer>
          );
        }
        default:
          return <Text>Unknown FileRead result type: {data.type}</Text>;
      }

    case 'Bash': // BashTool
      if (!data) return <Text>Bash result empty.</Text>
      
      // Determine result type based on stderr and exit code
      const hasError = data.stderr && data.stderr.trim() !== '';
      const wasInterrupted = data.interrupted;
      const resultType = wasInterrupted ? 'warning' : (hasError ? 'error' : 'success');
      
      return (
        <ToolResultContainer 
          title={wasInterrupted ? "Command Interrupted" : (hasError ? "Command Completed with Errors" : "Command Executed")}
          type={resultType}
        >
          <Box flexDirection="column">
            {data.stdout && (
              <Box flexDirection="column">
                <OutputLine content={data.stdout} lines={data.stdoutLines} verbose={verbose} />
              </Box>
            )}
            
            {hasError && (
              <Box flexDirection="column" marginTop={1}>
                <Text bold color={theme.error}>stderr:</Text>
                <OutputLine content={data.stderr} lines={data.stderrLines} verbose={verbose} isError={true} />
              </Box>
            )}
            
            {wasInterrupted && (
              <Text color={theme.warning}>The command was interrupted before completion</Text>
            )}
          </Box>
        </ToolResultContainer>
      );

    case 'Edit': // FileEditTool
      if (!data) return <Text>FileEdit result empty.</Text>
      
      return (
        <ToolResultContainer title={`File Updated: ${verbose ? data.filePath : relative(getCwd(), data.filePath)}`}>
          <FileEditToolUpdatedMessage
            filePath={data.filePath}
            structuredPatch={data.structuredPatch}
            verbose={verbose}
          />
        </ToolResultContainer>
      );

    case 'Replace': // FileWriteTool
      if (!data) return <Text>FileWrite result empty.</Text>
      
      switch (data.type) {
        case 'create': {
          const contentWithFallback = data.content || '(No content)';
          const numLines = data.content.split(EOL).length;
          const fileExt = extname(data.filePath).slice(1);
          
          return (
            <ToolResultContainer title={`File Created: ${verbose ? data.filePath : relative(getCwd(), data.filePath)}`}>
              <Box flexDirection="column">
                <Text>Created file with {numLines} lines</Text>
                <Box marginTop={1}>
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
                    language={fileExt}
                  />
                  {!verbose && numLines > MAX_LINES_TO_RENDER && (
                    <Text color={theme.secondaryText}>
                      ... (+{numLines - MAX_LINES_TO_RENDER} more lines)
                    </Text>
                  )}
                </Box>
              </Box>
            </ToolResultContainer>
          );
        }
        
        case 'update':
          if (!data.structuredPatch) return <Text>FileWrite update result structure invalid.</Text>
          
          return (
            <ToolResultContainer title={`File Updated: ${verbose ? data.filePath : relative(getCwd(), data.filePath)}`}>
              <FileEditToolUpdatedMessage
                filePath={data.filePath}
                structuredPatch={data.structuredPatch}
                verbose={verbose}
              />
            </ToolResultContainer>
          );
          
        default:
          return <Text>Unknown FileWrite result type: {data.type}</Text>;
      }

    case 'Glob': // GlobTool
      if (typeof data === 'string') {
        try { 
          data = JSON.parse(data); 
        } catch { 
          return <Text>Invalid Glob result format.</Text>
        }
      }
      
      if (!data || typeof data.numFiles === 'undefined') {
        return <Text>Glob result empty or invalid.</Text>;
      }
      
      return (
        <ToolResultContainer title="File Search Results">
          <Box flexDirection="column">
            <Box>
              <Text>Found </Text>
              <Text bold>{data.numFiles} </Text>
              <Text>{data.numFiles === 0 || data.numFiles > 1 ? 'files' : 'file'}</Text>
            </Box>
            
            {data.files && data.files.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                {data.files.slice(0, verbose ? undefined : 10).map((file: string, i: number) => (
                  <Text key={i}>{verbose ? file : relative(getCwd(), file)}</Text>
                ))}
                {!verbose && data.files.length > 10 && (
                  <Text color={theme.secondaryText}>... (+{data.files.length - 10} more files)</Text>
                )}
              </Box>
            )}
            
            <Box marginTop={1}>
              <Cost costUSD={0} durationMs={data.durationMs} debug={false} />
            </Box>
          </Box>
        </ToolResultContainer>
      );

    case 'Grep': // GrepTool
      if (typeof data === 'string') {
        try { 
          data = JSON.parse(data); 
        } catch { 
          return <Text>Invalid Grep result format.</Text>
        }
      }
      
      if (!data || typeof data.numFiles === 'undefined') {
        return <Text>Grep result empty or invalid.</Text>;
      }
      
      return (
        <ToolResultContainer title="Content Search Results">
          <Box flexDirection="column">
            <Box>
              <Text>Found </Text>
              <Text bold>{data.numFiles} </Text>
              <Text>{data.numFiles === 0 || data.numFiles > 1 ? 'files' : 'file'}</Text>
            </Box>
            
            {data.files && data.files.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                {data.files.slice(0, verbose ? undefined : 10).map((file: string, i: number) => (
                  <Text key={i}>{verbose ? file : relative(getCwd(), file)}</Text>
                ))}
                {!verbose && data.files.length > 10 && (
                  <Text color={theme.secondaryText}>... (+{data.files.length - 10} more files)</Text>
                )}
              </Box>
            )}
            
            <Box marginTop={1}>
              <Cost costUSD={0} durationMs={data.durationMs} debug={false} />
            </Box>
          </Box>
        </ToolResultContainer>
      );

    case 'LS': // lsTool
      if (typeof data !== 'string') {
        return <Text>LS result invalid.</Text>;
      }
      
      if (!data) {
        return null;
      }
      
      const lsLines = data.split('\n').filter(_ => _.trim() !== '');
      
      return (
        <ToolResultContainer title="Directory Listing">
          <Box flexDirection="column">
            {lsLines.slice(0, verbose ? undefined : 10).map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
            {!verbose && lsLines.length > 10 && (
              <Text color={theme.secondaryText}>... (+{lsLines.length - 10} more items)</Text>
            )}
          </Box>
        </ToolResultContainer>
      );

    case 'MemoryRead': // MemoryReadTool
      if (!data || typeof data.content === 'undefined') {
        return <Text>MemoryRead result empty or invalid.</Text>;
      }
      
      return (
        <ToolResultContainer title="Memory Read">
          <Box flexDirection="column">
            <Text>{data.content}</Text>
          </Box>
        </ToolResultContainer>
      );

    case 'MemoryWrite': // MemoryWriteTool
      return (
        <ToolResultContainer title="Memory Updated">
          <Text>Successfully saved to memory</Text>
        </ToolResultContainer>
      );

    case 'ReadNotebook': // NotebookReadTool
      const cells = data as any[]; // Use any[] instead of NotebookCellSource[]
      
      if (!cells || !Array.isArray(cells) || cells.length < 1 || !cells[0]) {
        return <Text>No cells found in notebook</Text>;
      }
      
      return (
        <ToolResultContainer title="Notebook Read">
          <Box flexDirection="column">
            <Text>Read {cells.length} cells from notebook</Text>
            
            {verbose && cells.slice(0, 3).map((cell, i) => (
              <Box key={i} flexDirection="column" marginTop={1}>
                <Text bold>Cell {i} ({cell.cell_type}):</Text>
                <HighlightedCode 
                  code={cell.source.slice(0, 200) + (cell.source.length > 200 ? '...' : '')} 
                  language={cell.cell_type === 'code' ? 'python' : 'markdown'} 
                />
              </Box>
            ))}
            
            {verbose && cells.length > 3 && (
              <Text color={theme.secondaryText}>... (+{cells.length - 3} more cells)</Text>
            )}
          </Box>
        </ToolResultContainer>
      );

    case 'NotebookEditCell': // NotebookEditTool
      if (!data) return <Text>NotebookEdit result empty.</Text>
      
      if (data.error) {
        return (
          <ToolResultContainer title="Notebook Edit Error" type="error">
            <Text color={theme.error}>{data.error}</Text>
          </ToolResultContainer>
        );
      }
      
      return (
        <ToolResultContainer title={`Notebook Cell ${data.cell_number} Updated`}>
          <Box flexDirection="column">
            <HighlightedCode 
              code={data.new_source} 
              language={data.language || 'python'} 
            />
          </Box>
        </ToolResultContainer>
      );

    case 'Architect': // ArchitectTool
      if (!data || !Array.isArray(data)) {
        return <Text>Architect result invalid.</Text>;
      }
      
      return (
        <ToolResultContainer title="Architecture Plan">
          <HighlightedCode
            code={data.map(_ => _.text).join('\n')}
            language="markdown"
          />
        </ToolResultContainer>
      );

    case 'mcp': // MCPTool
      if (Array.isArray(data)) {
        return (
          <ToolResultContainer title="MCP Result">
            <Box flexDirection="column">
              {data.map((item, i) => {
                if (item.type === 'image') {
                  return (
                    <Box key={i} flexDirection="row" marginBottom={1}>
                      <Text bold>[Image]</Text>
                    </Box>
                  );
                }
                
                const lines = item.text.split('\n').length;
                
                return (
                  <Box key={i} flexDirection="column" marginBottom={1}>
                    <OutputLine content={item.text} lines={lines} verbose={verbose} />
                  </Box>
                );
              })}
            </Box>
          </ToolResultContainer>
        );
      }
      
      if (!data) {
        return (
          <ToolResultContainer title="MCP Result" type="info">
            <Text color={theme.secondaryText}>(No content)</Text>
          </ToolResultContainer>
        );
      }
      
      const lines = data.split('\n').length;
      
      return (
        <ToolResultContainer title="MCP Result">
          <OutputLine content={data} lines={lines} verbose={verbose} />
        </ToolResultContainer>
      );

    case 'Task': // AgentTool
      if (!data) {
        return null;
      }
      
      return (
        <ToolResultContainer title="Agent Result">
          <Box flexDirection="column">
            {typeof data === 'string' ? (
              <Text>{data}</Text>
            ) : (
              <HighlightedCode
                code={Array.isArray(data) 
                  ? data.map((item: any) => item.text || '').join('\n')
                  : JSON.stringify(data, null, 2)
                }
                language="markdown"
              />
            )}
          </Box>
        </ToolResultContainer>
      );

    // Tools with no specific result message rendering in the original code:
    case 'Think': // ThinkTool - renders elsewhere
    case 'StickerRequest': // Rendered elsewhere
      return null; 

    default:
      // Fallback for unhandled tools with improved formatting
      return (
        <ToolResultContainer title={`${toolName} Result`} type="info">
          <Box flexDirection="column">
            <Text>{JSON.stringify(data, null, 2)}</Text>
          </Box>
        </ToolResultContainer>
      );
  }
}


// --- Rendering Tool Rejection Messages ---

export function renderToolUseRejectedMessage(toolName: string, input: any, context: { columns: number, verbose: boolean }): React.ReactNode {
    const { columns, verbose } = context;
    const theme = getTheme();
    
    switch (toolName) {
        case 'Edit': // FileEditTool
            try {
              // Get the patch for displaying the rejected changes
              const { patch } = applyEdit(input.file_path, input.old_string, input.new_string);
              const operationType = input.old_string === '' ? 'Create' : 'Update';
              const filePath = verbose ? input.file_path : relative(getCwd(), input.file_path);
              
              return (
                <ToolResultContainer title={`${operationType} Rejected: ${filePath}`} type="error">
                  <Box flexDirection="column">
                    <Text color={theme.error}>
                      User rejected {input.old_string === '' ? 'creating' : 'modifying'} this file.
                    </Text>
                    
                    <Box flexDirection="column" marginTop={1}>
                      {intersperse(
                        patch.map((p: Hunk) => (
                          <Box flexDirection="column" key={p.newStart}>
                            <StructuredDiff patch={p} dim={true} width={columns - 12} />
                          </Box>
                        )),
                        i => (
                          <Box key={`ellipsis-${i}`}>
                            <Text color={theme.secondaryText}>...</Text>
                          </Box>
                        ),
                      )}
                    </Box>
                  </Box>
                </ToolResultContainer>
              );
            } catch (e) {
              console.error("Error rendering FileEdit rejection:", e);
              return (
                <ToolResultContainer title="Edit Rejected" type="error">
                  <Text color={theme.error}>No changes were made to the file.</Text>
                </ToolResultContainer>
              );
            }

        case 'Replace': // FileWriteTool
            try {
                // Get full file path
                const fullFilePath = input.file_path.startsWith('/') ? input.file_path : `${getCwd()}/${input.file_path}`;
                const oldFileExists = existsSync(fullFilePath);
                const type = oldFileExists ? 'update' : 'create';
                const filePath = verbose ? input.file_path : relative(getCwd(), input.file_path);
                
                // Generate patch
                let patch: Hunk[] = [];
                if (oldFileExists) {
                    const enc = detectFileEncoding(fullFilePath);
                    const oldContent = readFileSync(fullFilePath, enc);
                    patch = getPatch({ 
                        filePath: input.file_path, 
                        fileContents: oldContent.toString(), 
                        oldStr: oldContent.toString(), 
                        newStr: input.content 
                    });
                } else {
                    // For new files, create patch showing entire content as added
                    patch = getPatch({ 
                        filePath: input.file_path, 
                        fileContents: '', 
                        oldStr: '', 
                        newStr: input.content 
                    });
                }
                
                return (
                    <ToolResultContainer title={`File ${type === 'update' ? 'Update' : 'Creation'} Rejected: ${filePath}`} type="error">
                      <Box flexDirection="column">
                        <Text color={theme.error}>
                          User rejected {type === 'update' ? 'modifying' : 'creating'} this file.
                        </Text>
                        
                        <Box flexDirection="column" marginTop={1}>
                          {intersperse(
                            patch.map((p: Hunk) => (
                              <Box flexDirection="column" key={p.newStart}>
                                <StructuredDiff patch={p} dim={true} width={columns - 12} />
                              </Box>
                            )),
                            i => (
                              <Box key={`ellipsis-${i}`}>
                                <Text color={theme.secondaryText}>...</Text>
                              </Box>
                            ),
                          )}
                        </Box>
                      </Box>
                    </ToolResultContainer>
                );
            } catch (e) {
                console.error("Error rendering FileWrite rejection:", e);
                return (
                    <ToolResultContainer title="File Write Rejected" type="error">
                      <Text color={theme.error}>No changes were made to the file.</Text>
                    </ToolResultContainer>
                );
            }

        case 'Bash': // BashTool
            return (
                <ToolResultContainer title="Command Execution Rejected" type="error">
                    <Box flexDirection="column">
                        <Text color={theme.error}>User rejected executing this command:</Text>
                        <Box marginTop={1} marginLeft={2}>
                            <HighlightedCode code={input.command} language="bash" />
                        </Box>
                    </Box>
                </ToolResultContainer>
            );

        case 'StickerRequest': // StickerRequestTool
            return (
                <ToolResultContainer title="Sticker Request Rejected" type="error">
                    <Text color={theme.error}>User rejected sticker request.</Text>
                </ToolResultContainer>
            );

        case 'Think': // ThinkTool
            return (
                <ToolResultContainer title="Thought Process Cancelled" type="warning">
                    <Text color={theme.warning}>User cancelled the thinking process.</Text>
                </ToolResultContainer>
            );

        case 'View': // FileReadTool
            return (
                <ToolResultContainer title="File Access Rejected" type="error">
                    <Box flexDirection="column">
                        <Text color={theme.error}>User rejected reading this file:</Text>
                        <Text bold>{verbose ? input.file_path : relative(getCwd(), input.file_path || "")}</Text>
                    </Box>
                </ToolResultContainer>
            );

        case 'Glob': // GlobTool
        case 'Grep': // GrepTool
            return (
                <ToolResultContainer title="Search Operation Rejected" type="error">
                    <Text color={theme.error}>User rejected the search operation.</Text>
                </ToolResultContainer>
            );
            
        case 'LS': // lsTool
            return (
                <ToolResultContainer title="Directory Listing Rejected" type="error">
                    <Text color={theme.error}>
                        User rejected listing the contents of: {verbose ? input.path : relative(getCwd(), input.path || ".")}
                    </Text>
                </ToolResultContainer>
            );
            
        case 'ReadNotebook': // NotebookReadTool
            return (
                <ToolResultContainer title="Notebook Access Rejected" type="error">
                    <Text color={theme.error}>
                        User rejected reading notebook: {verbose ? input.notebook_path : relative(getCwd(), input.notebook_path || "")}
                    </Text>
                </ToolResultContainer>
            );
            
        case 'NotebookEditCell': // NotebookEditTool
            return (
                <ToolResultContainer title="Notebook Edit Rejected" type="error">
                    <Text color={theme.error}>
                        User rejected editing cell {input.cell_number} in notebook: {verbose ? input.notebook_path : relative(getCwd(), input.notebook_path || "")}
                    </Text>
                </ToolResultContainer>
            );
            
        case 'Task': // AgentTool
            return (
                <ToolResultContainer title="Agent Task Rejected" type="error">
                    <Text color={theme.error}>User rejected executing the agent task.</Text>
                </ToolResultContainer>
            );
            
        case 'Architect': // ArchitectTool
            return (
                <ToolResultContainer title="Architecture Analysis Rejected" type="error">
                    <Text color={theme.error}>User rejected the architecture analysis task.</Text>
                </ToolResultContainer>
            );
            
        case 'mcp': // MCPTool
            return (
                <ToolResultContainer title="MCP Operation Rejected" type="error">
                    <Text color={theme.error}>User rejected the MCP operation.</Text>
                </ToolResultContainer>
            );
            
        case 'MemoryRead': // MemoryReadTool
        case 'MemoryWrite': // MemoryWriteTool
            return (
                <ToolResultContainer title="Memory Operation Rejected" type="error">
                    <Text color={theme.error}>User rejected the memory operation.</Text>
                </ToolResultContainer>
            );
            
        default:
            // Generic rejection for unknown tools
            return (
                <ToolResultContainer title={`${toolName} Rejected`} type="error">
                    <Text color={theme.error}>User rejected this operation.</Text>
                </ToolResultContainer>
            );
    }
} 