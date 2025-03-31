import { Message } from '../agent';
import { Tool } from '../../Tool';
import { GlobalConfig as Config } from '../../utils/config';

// Define the structure for Session State
export interface SessionState {
	messages: Message[];
	currentWorkingDirectory: string;
	tools: Tool[];
	config: Config; // Represents GlobalConfig
	history?: string[]; // Optional, depending on how history is managed
	[key: string]: any; // Allow for extensibility if needed
}

// Define the interface for Session Management
export interface ISessionManager {
	/**
	 * Retrieves the complete state for a given session ID.
	 * @param sessionId The unique identifier for the session.
	 * @returns A promise that resolves with the session state.
	 */
	getSessionState(sessionId: string): Promise<SessionState>;

	/**
	 * Saves the complete state for a given session ID.
	 * @param sessionId The unique identifier for the session.
	 * @param state The session state object to save.
	 * @returns A promise that resolves when the state is saved.
	 */
	saveSessionState(sessionId: string, state: Partial<SessionState>): Promise<void>;

	/**
	 * Retrieves the command history for a session.
	 * @param sessionId The unique identifier for the session.
	 * @returns A promise that resolves with an array of command strings.
	 */
	getHistory(sessionId: string): Promise<string[]>;

	/**
	 * Adds a command to the session's history.
	 * @param sessionId The unique identifier for the session.
	 * @param command The command string to add.
	 * @returns A promise that resolves when the command is added.
	 */
	addToHistory(sessionId: string, command: string): Promise<void>;

	/**
	 * Gets the current working directory for the session.
	 * @param sessionId The unique identifier for the session.
	 * @returns A promise that resolves with the CWD path string.
	 */
	getCurrentWorkingDirectory(sessionId: string): Promise<string>;

	/**
	 * Sets the current working directory for the session.
	 * @param sessionId The unique identifier for the session.
	 * @param path The new CWD path string.
	 * @returns A promise that resolves when the CWD is set.
	 */
	setCurrentWorkingDirectory(sessionId: string, path: string): Promise<void>;

	/**
	 * Retrieves the message list for a session.
	 * @param sessionId The unique identifier for the session.
	 * @returns A promise that resolves with the array of messages.
	 */
	getMessages(sessionId: string): Promise<Message[]>;

	/**
	 * Sets the message list for a session.
	 * @param sessionId The unique identifier for the session.
	 * @param messages The array of messages to set.
	 * @returns A promise that resolves when the messages are set.
	 */
	setMessages(sessionId: string, messages: Message[]): Promise<void>;
} 