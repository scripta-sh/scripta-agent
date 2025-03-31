/**
 * Type definitions for Jupyter notebook-related tools
 */

/**
 * Jupyter notebook cell data
 */
export interface NotebookCell {
  cell_type: 'code' | 'markdown' | 'raw';
  execution_count?: number | null;
  metadata?: Record<string, any>;
  source: string | string[];
  outputs?: NotebookCellOutput[];
}

/**
 * Jupyter notebook cell output
 */
export interface NotebookCellOutput {
  output_type: 'stream' | 'display_data' | 'execute_result' | 'error';
  execution_count?: number;
  data?: Record<string, any>;
  metadata?: Record<string, any>;
  text?: string | string[];
  name?: string;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

/**
 * Jupyter notebook metadata
 */
export interface NotebookMetadata {
  kernelspec?: {
    display_name: string;
    language: string;
    name: string;
  };
  language_info?: {
    codemirror_mode?: string | Record<string, any>;
    file_extension?: string;
    mimetype?: string;
    name: string;
    nbconvert_exporter?: string;
    pygments_lexer?: string;
    version?: string;
  };
  [key: string]: any;
}

/**
 * Jupyter notebook document
 */
export interface NotebookDocument {
  cells: NotebookCell[];
  metadata: NotebookMetadata;
  nbformat: number;
  nbformat_minor: number;
}