import { IConfigService } from '@core/config/IConfigService';
import {
    getGlobalConfig as getGlobalConfigCli,
    saveGlobalConfig as saveGlobalConfigCli,
    getCurrentProjectConfig as getCurrentProjectConfigCli,
    saveCurrentProjectConfig as saveCurrentProjectConfigCli,
    GlobalConfig, ProjectConfig
} from '../../utils/config'; // Import existing CLI config utils

/**
 * CLI implementation of IConfigService.
 * Wraps the existing file-based configuration utility functions.
 */
export class CliConfigService implements IConfigService {
    getGlobalConfig(): GlobalConfig {
        // Directly call the existing CLI utility
        return getGlobalConfigCli();
    }

    saveGlobalConfig(config: GlobalConfig): void {
        // Directly call the existing CLI utility
        saveGlobalConfigCli(config);
    }

    getProjectConfig(projectPath: string): ProjectConfig {
        // NOTE: The existing CLI util likely relies on the current process CWD.
        // This implementation assumes the requested projectPath matches the process CWD.
        // A more robust implementation might need to read/cache configs from different paths.
        if (projectPath !== process.cwd()) {
            // Log a warning or throw an error if the path doesn't match?
            // For now, we'll log a warning and proceed, relying on the existing behavior.
            console.warn(`CliConfigService.getProjectConfig: Requested path "${projectPath}" differs from process CWD "${process.cwd()}". Relying on existing getCurrentProjectConfig behavior.`);
        }
        // Directly call the existing CLI utility
        return getCurrentProjectConfigCli(); 
    }

    saveProjectConfig(projectPath: string, config: ProjectConfig): void {
        // NOTE: Similar limitation as getProjectConfig regarding the path.
        if (projectPath !== process.cwd()) {
            console.warn(`CliConfigService.saveProjectConfig: Requested path "${projectPath}" differs from process CWD "${process.cwd()}". Relying on existing saveCurrentProjectConfig behavior.`);
        }
         // Directly call the existing CLI utility
        saveCurrentProjectConfigCli(config);
    }
} 