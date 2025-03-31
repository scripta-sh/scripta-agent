/**
 * BaseTool abstract class
 * Provides common functionality for all tools
 */

import * as z from 'zod';
import { Tool, ToolUseContext } from '../interfaces/Tool';

/**
 * Abstract base class for all tools
 * Implements common functionality and ensures tools adhere to the Tool interface
 */
export abstract class BaseTool implements Tool {
  // Basic properties - must be implemented by tool
  abstract name: string;
  abstract description: string | ((input: any) => Promise<string>);
  abstract inputSchema: z.ZodObject<any>;
  
  // Optional properties with default implementations
  inputJSONSchema?: Record<string, unknown>;
  
  // UI methods - must be implemented by tool
  abstract prompt(options: { dangerouslySkipPermissions: boolean }): Promise<string>;
  abstract userFacingName(input: any): string | React.ReactNode;
  
  // Tool capability methods - can be overridden
  async isEnabled(): Promise<boolean> {
    return true;
  }
  
  isReadOnly(): boolean {
    return false;
  }
  
  needsPermissions(input: any): boolean {
    return true;
  }
  
  // Validation method - can be overridden
  async validateInput(input: any, context: ToolUseContext): Promise<{ 
    result: boolean; 
    message?: string; 
    meta?: Record<string, any> 
  }> {
    try {
      this.inputSchema.parse(input);
      return { result: true };
    } catch (error) {
      return { 
        result: false, 
        message: error instanceof Error ? error.message : 'Invalid input'
      };
    }
  }
  
  // Call method - must be implemented by tool
  abstract call(input: any, context: ToolUseContext): AsyncGenerator<{
    type: string;
    data: any;
  }, any, unknown>;
  
  // Optional rendering method - can be overridden
  renderResultForAssistant?(data: any): any {
    return data;
  }
}