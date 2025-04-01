import { GlobalConfig, ProjectConfig } from '../../utils/config'; // Adjust path later if config types move

/**
 * Interface for accessing global and project-specific configurations.
 * Allows decoupling the core from the specific config storage mechanism (e.g., file vs. server env).
 */
export interface IConfigService {
    /**
     * Retrieves the global configuration.
     * @returns The global configuration object.
     */
    getGlobalConfig(): GlobalConfig;

    /**
     * Saves the global configuration.
     * @param config The global configuration object to save.
     */
    saveGlobalConfig(config: GlobalConfig): void;

    /**
     * Retrieves the project-specific configuration for a given path.
     * @param projectPath The root path of the project.
     * @returns The project configuration object.
     */
    getProjectConfig(projectPath: string): ProjectConfig;

    /**
     * Saves the project-specific configuration for a given path.
     * @param projectPath The root path of the project.
     * @param config The project configuration object to save.
     */
    saveProjectConfig(projectPath: string, config: ProjectConfig): void;

    // Add other necessary methods like getMcprcConfig if needed abstractly
    // getMcprcConfig?(path: string): McprcConfig | null;
} 