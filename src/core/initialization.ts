/**
 * Core initialization module
 * This file is responsible for initializing the core components of the application
 */

import { getAllTools, getEnabledTools } from './tools/registry';
import { createComponentLogger } from '../utils/log';
import './tools/filesystem';  // Import to register filesystem tools
import './tools/shell';       // Import to register shell tools
import './tools/notebook';    // Import to register notebook tools
import './tools/memory';      // Import to register memory tools
import './tools/agent';       // Import to register agent tools
import './tools/external';    // Import to register external tools

/**
 * Initialize the core components
 * This function should be called at application startup
 */
export async function initializeCore(): Promise<void> {
  // Import tool modules to register them with the registry
  // The imports at the top of this file handle registering the tools
  
  try {
    // Log information about registered tools
    const allTools = getAllTools();
    
    // Use logger
    const logger = createComponentLogger('ScriptaCore');
    
    logger.info(`Initialized core with ${allTools.length} registered tools: ${allTools.map(t => t.name).join(', ')}`);
    
    // Validate that all tools are properly registered
    const enabledTools = await getEnabledTools();
    logger.info(`${enabledTools.length} tools are enabled: ${enabledTools.map(t => t.name).join(', ')}`);
    
    // Additional initialization logic can be added here
  } catch (error) {
    console.error('Error initializing core tools:', error);
    // Don't throw - continue with application startup even if tool initialization fails
  }
}

/**
 * Get information about the core initialization status
 */
export function getCoreStatus(): { 
  totalTools: number; 
  toolNames: string[]; 
} {
  const allTools = getAllTools();
  return {
    totalTools: allTools.length,
    toolNames: allTools.map(tool => tool.name),
  };
}