import type {
  ImageBlockParam,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'

import { existsSync, readFileSync } from 'fs'
import { extname, isAbsolute, relative, resolve } from 'path'
import { z } from 'zod'
import { BaseTool } from '../../base/BaseTool'
import { ToolUseContext } from '../../types'
import { DESCRIPTION, PROMPT } from './prompt'
import {
  NotebookCellSource,
  NotebookContent,
  NotebookCell,
  NotebookOutputImage,
  NotebookCellSourceOutput,
  NotebookCellOutput,
  NotebookCellType,
} from '../../types/notebook'

// Utility imports - will be updated later
import { formatOutput } from '../../shell/BashTool/utils'
import { getCwd } from '../../../../utils/state'
import { findSimilarFile } from '../../../../utils/file'
import { hasReadPermission } from '../../../../utils/permissions/filesystem'

const inputSchema = z.strictObject({
  notebook_path: z
    .string()
    .describe(
      'The absolute path to the Jupyter notebook file to read (must be absolute, not relative)',
    ),
})

type NotebookReadToolInput = z.infer<typeof inputSchema>;
type NotebookReadToolOutput = NotebookCellSource[];

export class CoreNotebookReadTool extends BaseTool {
  name = 'ReadNotebook';
  inputSchema = inputSchema;

  async description() {
    return DESCRIPTION;
  }

  async prompt() {
    return PROMPT;
  }

  isReadOnly(): boolean {
    return true;
  }

  userFacingName() {
    return 'Read Notebook';
  }

  async isEnabled() {
    return true;
  }

  needsPermissions({ notebook_path }: NotebookReadToolInput) {
    return !hasReadPermission(notebook_path);
  }

  async validateInput({ notebook_path }: NotebookReadToolInput) {
    const fullFilePath = isAbsolute(notebook_path)
      ? notebook_path
      : resolve(getCwd(), notebook_path);

    if (!existsSync(fullFilePath)) {
      // Try to find a similar file with a different extension
      const similarFilename = findSimilarFile(fullFilePath);
      let message = 'File does not exist.';

      // If we found a similar file, suggest it to the assistant
      if (similarFilename) {
        message += ` Did you mean ${similarFilename}?`;
      }

      return {
        result: false,
        message,
      };
    }

    if (extname(fullFilePath) !== '.ipynb') {
      return {
        result: false,
        message: 'File must be a Jupyter notebook (.ipynb file).',
      };
    }

    return { result: true };
  }

  async *call({ notebook_path }: NotebookReadToolInput,
    { abortSignal }: ToolUseContext
  ) {
    const fullPath = isAbsolute(notebook_path)
      ? notebook_path
      : resolve(getCwd(), notebook_path);

    const content = readFileSync(fullPath, 'utf-8');
    const notebook = JSON.parse(content) as NotebookContent;
    const language = notebook.metadata.language_info?.name ?? 'python';
    const cells = notebook.cells.map((cell, index) =>
      processCell(cell, index, language),
    );

    yield {
      type: 'result',
      resultForAssistant: this.renderResultForAssistant(cells),
      data: cells,
    };
  }

  renderResultForAssistant(data: NotebookReadToolOutput) {
    return renderResultForAssistant(data);
  }
}

function processOutputText(text: string | string[] | undefined): string {
  if (!text) return '';
  const rawText = Array.isArray(text) ? text.join('') : text;
  const { truncatedContent } = formatOutput(rawText);
  return truncatedContent;
}

function extractImage(
  data: Record<string, unknown>,
): NotebookOutputImage | undefined {
  if (typeof data['image/png'] === 'string') {
    return {
      image_data: data['image/png'] as string,
      media_type: 'image/png',
    };
  }
  if (typeof data['image/jpeg'] === 'string') {
    return {
      image_data: data['image/jpeg'] as string,
      media_type: 'image/jpeg',
    };
  }
  return undefined;
}

function processOutput(output: NotebookCellOutput) {
  switch (output.output_type) {
    case 'stream':
      return {
        output_type: output.output_type,
        text: processOutputText(output.text),
      };
    case 'execute_result':
    case 'display_data':
      return {
        output_type: output.output_type,
        text: processOutputText(output.data?.['text/plain']),
        image: output.data && extractImage(output.data),
      };
    case 'error':
      return {
        output_type: output.output_type,
        text: processOutputText(
          `${output.ename}: ${output.evalue}\n${output.traceback.join('\n')}`,
        ),
      };
  }
}

function processCell(
  cell: NotebookCell,
  index: number,
  language: string,
): NotebookCellSource {
  const cellData: NotebookCellSource = {
    cell: index,
    cellType: cell.cell_type,
    source: Array.isArray(cell.source) ? cell.source.join('') : cell.source,
    language,
    execution_count: cell.execution_count,
  };

  if (cell.outputs?.length) {
    cellData.outputs = cell.outputs.map(processOutput);
  }

  return cellData;
}

function cellContentToToolResult(cell: NotebookCellSource): TextBlockParam {
  const metadata = [];
  if (cell.cellType !== 'code') {
    metadata.push(`<cell_type>${cell.cellType}</cell_type>`);
  }
  if (cell.language !== 'python' && cell.cellType === 'code') {
    metadata.push(`<language>${cell.language}</language>`);
  }
  const cellContent = `<cell ${cell.cell}>${metadata.join('')}${cell.source}</cell ${cell.cell}>`;
  return {
    text: cellContent,
    type: 'text',
  };
}

function cellOutputToToolResult(output: NotebookCellSourceOutput) {
  const outputs: (TextBlockParam | ImageBlockParam)[] = [];
  if (output.text) {
    outputs.push({
      text: `\n${output.text}`,
      type: 'text',
    });
  }
  if (output.image) {
    outputs.push({
      type: 'image',
      source: {
        data: output.image.image_data,
        media_type: output.image.media_type,
        type: 'base64',
      },
    });
  }
  return outputs;
}

function getToolResultFromCell(cell: NotebookCellSource) {
  const contentResult = cellContentToToolResult(cell);
  const outputResults = cell.outputs?.flatMap(cellOutputToToolResult);
  return [contentResult, ...(outputResults ?? [])];
}

export function renderResultForAssistant(data: NotebookCellSource[]) {
  const allResults = data.flatMap(getToolResultFromCell);

  // Merge adjacent text blocks
  return allResults.reduce<(TextBlockParam | ImageBlockParam)[]>(
    (acc, curr) => {
      if (acc.length === 0) return [curr];

      const prev = acc[acc.length - 1];
      if (prev && prev.type === 'text' && curr.type === 'text') {
        // Merge the text blocks
        prev.text += '\n' + curr.text;
        return acc;
      }

      return [...acc, curr];
    },
    [],
  );
}

export function isNotebookCellType(
  value: string | null,
): value is NotebookCellType {
  return value === 'code' || value === 'markdown';
}