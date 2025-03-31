/**
 * DEPRECATED: Legacy adapter for the conversation agent
 * Use imports from core/agent instead
 */

// Re-export types from core/agent
export * from './core/agent/types';

// Re-export the main query function
export { query } from './core/agent/ConversationAgent';

// Re-export tool execution utilities
export { runToolUse, runToolsConcurrently, runToolsSerially } from './core/agent/ToolExecutor';

// Re-export other utility functions
export { normalizeToolInput, formatError, queryWithBinaryFeedback } from './core/agent/utils';

// Log a deprecation warning
import { createComponentLogger } from './utils/log';
const logger = createComponentLogger('LegacyQueryModule');
logger.warn('DEPRECATED: Using src/query.ts is deprecated. Import from core/agent instead.');