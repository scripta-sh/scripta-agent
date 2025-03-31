import { Message } from '../../core/agent';
import {
	ISessionManager,
	SessionState,
} from '../../core/session/ISessionManager';
import {
	getMessagesGetter,
	getMessagesSetter,
} from '../../messages';
import { getHistory as getCliHistory, addToHistory as addToCliHistory } from '../../history';
import { getCwd as getCliCwd, setCwd as setCliCwd } from '../../utils/state';
import { getGlobalConfig, GlobalConfig } from '../../utils/config'; // Use getGlobalConfig
import { Tool } from '../../core/tools/interfaces/Tool'; // Import Tool from core
import { getEnabledTools } from '../../core/tools/registry'; // Import registry function
import chalk from 'chalk';
import { createComponentLogger } from '../../utils/log';

// Create a logger for this component
const logger = createComponentLogger('CliSessionManager');

// Define the types locally based on the return types of the getter functions
type MessageGetter = ReturnType<typeof getMessagesGetter>;
type MessageSetter = ReturnType<typeof getMessagesSetter>;

/**
 * A session manager implementation specifically for the CLI environment.
 * Since the CLI typically runs as a single, persistent process, this manager
 * interacts directly with the existing global state management functions
 * (`messages.ts`, `history.ts`, `state.ts`).
 *
 * It largely ignores the `sessionId` as there's only one session.
 */
export class CliSessionManager implements ISessionManager {
	constructor() {
		// Don't initialize here - will fetch on demand
	}

	// Helper to ensure getters/setters are initialized
	private ensureInitialized(): { 
		messagesGetter: MessageGetter; 
		messagesSetter: MessageSetter; 
	} {
		const messagesGetter = getMessagesGetter();
		const messagesSetter = getMessagesSetter();
		if (!messagesGetter || !messagesSetter) {
			throw new Error('CliSessionManager used before message getters/setters were initialized.');
		}
		return { messagesGetter, messagesSetter };
	}

	async getSessionState(sessionId: string): Promise<SessionState> {
		const { messagesGetter } = this.ensureInitialized();
		// In CLI, sessionId is ignored. We fetch the current global state.
		const messages = messagesGetter();
		const currentWorkingDirectory = getCliCwd(); // Assuming sync
		const config: GlobalConfig = getGlobalConfig(); // Fetch current global config
		const tools: Tool[] = await getEnabledTools(); // Get enabled tools from registry
		const history: string[] = await getCliHistory(); // Fetch history

		logger.debug(`getSessionState returning ${messages.length} messages`);
		if (messages.length > 0) {
			const firstMessage = messages[0];
			const lastMessage = messages[messages.length - 1];
			logger.debug(`First message: ${firstMessage.type.toUpperCase()}: ${
				firstMessage.type === 'user' && typeof firstMessage.message.content === 'string' 
					? firstMessage.message.content.substring(0, 30) + '...' 
					: firstMessage.type === 'assistant' && 
					  firstMessage.message.content[0]?.type === 'text' 
						? (firstMessage.message.content[0] as any).text.substring(0, 30) + '...'
						: 'non-text content'
			}`);
			
			logger.debug(`Last message: ${lastMessage.type.toUpperCase()}: ${
				lastMessage.type === 'user' && typeof lastMessage.message.content === 'string' 
					? lastMessage.message.content.substring(0, 30) + '...' 
					: lastMessage.type === 'assistant' && 
					  lastMessage.message.content[0]?.type === 'text' 
						? (lastMessage.message.content[0] as any).text.substring(0, 30) + '...'
						: 'non-text content'
			}`);
		}

		return {
			messages,
			currentWorkingDirectory,
			tools,
			config,
			history,
		};
	}

	async saveSessionState(sessionId: string, state: Partial<SessionState>): Promise<void> {
		const { messagesSetter } = this.ensureInitialized();
		// In CLI, sessionId is ignored. We update the relevant parts of the global state.
		if (state.messages !== undefined) {
			messagesSetter(state.messages);
		}
		if (state.currentWorkingDirectory !== undefined) {
			await setCliCwd(state.currentWorkingDirectory); // Assuming async
		}
		// Config and tools are generally not dynamically set this way in the CLI context.
		// History is managed via addToHistory.
		// We don't save the whole config back, specific config setters should be used if needed.
	}

	async getHistory(sessionId: string): Promise<string[]> {
		// Ignore sessionId for CLI
		return getCliHistory();
	}

	async addToHistory(sessionId: string, command: string): Promise<void> {
		// Ignore sessionId for CLI
		return addToCliHistory(command);
	}

	async getCurrentWorkingDirectory(sessionId: string): Promise<string> {
		// Ignore sessionId for CLI
		// Assuming getCliCwd is synchronous based on current usage, but wrap in Promise.resolve for interface consistency
		return Promise.resolve(getCliCwd());
	}

	async setCurrentWorkingDirectory(sessionId: string, path: string): Promise<void> {
		// Ignore sessionId for CLI
		return setCliCwd(path); // Assuming async
	}

	async getMessages(sessionId: string): Promise<Message[]> {
		const { messagesGetter } = this.ensureInitialized();
		// Ignore sessionId for CLI
		return Promise.resolve(messagesGetter()); // Wrap in Promise.resolve for consistency
	}

	async setMessages(sessionId: string, messages: Message[]): Promise<void> {
		const { messagesSetter, messagesGetter } = this.ensureInitialized();
		
		logger.debug(`Setting ${messages.length} messages to session state`);
		if (messages.length > 0) {
			const firstMessage = messages[0];
			const lastMessage = messages[messages.length - 1];
			logger.debug(`First message to set: ${firstMessage.type.toUpperCase()}: ${
				firstMessage.type === 'user' && typeof firstMessage.message.content === 'string' 
					? firstMessage.message.content.substring(0, 30) + '...' 
					: firstMessage.type === 'assistant' && 
					  firstMessage.message.content[0]?.type === 'text' 
						? (firstMessage.message.content[0] as any).text.substring(0, 30) + '...'
						: 'non-text content'
			}`);
			
			logger.debug(`Last message to set: ${lastMessage.type.toUpperCase()}: ${
				lastMessage.type === 'user' && typeof lastMessage.message.content === 'string' 
					? lastMessage.message.content.substring(0, 30) + '...' 
					: lastMessage.type === 'assistant' && 
					  lastMessage.message.content[0]?.type === 'text' 
						? (lastMessage.message.content[0] as any).text.substring(0, 30) + '...'
						: 'non-text content'
			}`);
		}
		
		// Filter out any duplicate messages by comparing user message content
		const uniqueMessages = messages.reduce((acc: Message[], current) => {
			// If it's not a user message, add it
			if (current.type !== 'user') {
				acc.push(current);
				return acc;
			}
			
			// Check if this user message already exists
			const isDuplicate = acc.some(m => 
				m.type === 'user' && 
				typeof m.message.content === 'string' && 
				typeof current.message.content === 'string' &&
				m.message.content === current.message.content
			);
			
			if (!isDuplicate) {
				acc.push(current);
			} else {
				logger.debug(`Filtered out duplicate user message: ${
					typeof current.message.content === 'string' 
						? current.message.content.substring(0, 30) + '...' 
						: 'non-text content'
				}`);
			}
			
			return acc;
		}, []);
		
		if (uniqueMessages.length !== messages.length) {
			logger.debug(`Filtered ${messages.length - uniqueMessages.length} duplicate messages`);
		}
		
		// Get current messages to check state
		const currentMessages = messagesGetter();
		logger.debug(`Current messages in React state: ${currentMessages.length}`);
		
		// Use messagesSetter from the initialized values
		logger.debug(`Saving ${uniqueMessages.length} messages to state`);
		// Clone messages array to ensure React recognizes the change
		messagesSetter([...uniqueMessages]);
		
		// Wait a short time to ensure the state update has propagated
		await new Promise(resolve => setTimeout(resolve, 5));
		
		return Promise.resolve(); // Wrap in Promise.resolve for consistency
	}
} 