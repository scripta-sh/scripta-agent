# Scripta Agent Refactoring Guide

## Overview

This document outlines the refactoring of the Scripta Agent codebase to properly separate core business logic from CLI-specific code, enabling the core functionality to be reused in other interfaces like web/desktop applications.

## Goals

- Separate core business logic from CLI-specific code
- Remove CLI dependencies from core modules
- Create clear interfaces between core and CLI
- Enable reuse of core functionality in other interfaces
- Maintain existing CLI functionality

## Directory Structure

The refactored codebase follows this directory structure:

```
src/
├── core/                  # Core business logic only
│   ├── agent/             # Agent-related logic
│   ├── tools/             # Tool definitions and implementations
│   │   └── interfaces/    # Pure interfaces without UI dependencies
│   ├── providers/         # Provider implementations
│   ├── session/           # Session management interfaces
│   ├── permissions/       # Permission handling interfaces
│   └── utils/             # Core-specific utilities
├── cli/                   # CLI-specific code
│   ├── components/        # React components
│   ├── screens/           # CLI screens
│   ├── session/           # CLI session implementation
│   ├── permissions/       # CLI permission implementation
│   ├── renderers/         # Tool result renderers
│   └── utils/             # CLI-specific utilities
├── shared/                # Shared utilities used by both core and CLI
│   ├── config/            # Configuration utilities
│   ├── logging/           # Logging utilities
│   └── filesystem/        # File system utilities
└── entrypoints/           # Application entry points
```

## Key Interfaces

### Core Interfaces

The core module defines several key interfaces that CLI or other UI implementations must implement:

1. **CoreTool Interface** (`src/core/utils/CoreTool.ts`):
   - Defines the core functionality of tools without UI dependencies
   - Provides methods for tool execution and permission checking

2. **ISessionManager** (`src/core/session/ISessionManager.ts`):
   - Manages conversation state and history
   - Handles message processing and storage

3. **IPermissionHandler** (`src/core/permissions/IPermissionHandler.ts`):
   - Defines methods for checking and requesting permissions
   - UI-agnostic permission handling

### CLI Implementations

The CLI module implements the core interfaces with UI-specific functionality:

1. **ToolRenderer** (`src/cli/utils/ToolRenderer.ts`):
   - Renders tool results in the CLI
   - Handles UI-specific rendering logic

2. **CliSessionManager** (`src/cli/session/CliSessionManager.ts`):
   - Implements ISessionManager for CLI
   - Manages CLI-specific session state

3. **CliPermissionHandler** (`src/cli/permissions/CliPermissionHandler.ts`):
   - Implements IPermissionHandler for CLI
   - Handles CLI-specific permission requests

## Shared Utilities

Shared utilities are used by both core and CLI modules:

1. **Configuration** (`src/shared/config/`):
   - Manages global and project-specific configurations
   - Handles API keys and model settings

2. **Logging** (`src/shared/logging/`):
   - Provides logging utilities
   - Used by both core and CLI

3. **Filesystem** (`src/shared/filesystem/`):
   - File system utilities
   - Used by both core and CLI

## Usage

### Using Core Module in Other Interfaces

To use the core module in other interfaces (web, desktop, etc.):

1. Implement the core interfaces (ISessionManager, IPermissionHandler)
2. Create UI-specific renderers for tool results
3. Use the core module for business logic

Example:

```typescript
// Web implementation of ISessionManager
class WebSessionManager implements ISessionManager {
  // Implement methods
}

// Web implementation of IPermissionHandler
class WebPermissionHandler implements IPermissionHandler {
  // Implement methods
}

// Initialize ScriptaCore with web implementations
const scriptaCore = new ScriptaCore({
  sessionManager: new WebSessionManager(),
  permissionHandler: new WebPermissionHandler(),
});
```

## Migration Guide

When migrating existing code:

1. Move core business logic to the core module
2. Move UI-specific code to the CLI module
3. Update import paths to use the new structure
4. Use dependency injection to provide CLI implementations to core

## Testing

To test the refactored codebase:

1. Run the CLI tool to ensure it functions as expected:
   ```
   pnpm run dev
   ```

2. Verify that core functionality works properly
3. Ensure no regressions in existing functionality

## Future Improvements

Future improvements to consider:

1. Further separation of concerns
2. More comprehensive interfaces
3. Better dependency injection
4. Additional UI implementations (web, desktop)
