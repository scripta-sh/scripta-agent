# Scripta-Agent: Comprehensive Implementation Plan

This document consolidates the vision, implementation plan, and tracking for transforming the CLI-based Scripta-Agent into an autonomous AI-powered software execution system. It combines content from:
- Proposed-System.md: The high-level vision
- ArchitecturalTransformation.md: The architectural evolution
- TransformationPlan.md: The phased approach
- Phase1Implementation.md: The detailed implementation of Phase 1

## 1. Vision & Architecture

Scripta-Agent will be an autonomous AI-powered software execution system that receives user requests from multiple sources (Slack, Linear, GitHub, JIRA) and performs code modifications, UI testing, and deployment workflows while interacting with users as needed. It will operate in a cloud-based, containerized environment, leveraging MCPs (Model Context Protocols) for dynamic context retrieval and cloud resources for browser & mobile testing.

The system will ensure that all execution steps, intermediate agent outputs, and user inputs are logged in real-time into a Web Dashboard, providing full transparency and control.

### Current Limitations

Claude-Code today operates as a REPL-based CLI agent, where a user sends a query → gets a response → sends another query. While effective for single-turn interactions, it lacks the ability to:

- Persist state across requests dynamically
- Handle multi-source asynchronous requests
- Spin up cloud resources or execute UI tests
- Stream execution logs into an interactive dashboard

### Why This Transformation Is Needed

To evolve into Scripta-Agent, Claude-Code needs to be refactored from a CLI loop into an autonomous, persistent, and cloud-aware agent:

#### 1. Transition from REPL CLI to a Persistent API-Based Agent
- Instead of a command-line loop, Claude-Code needs to run as a continuously active microservice
- Requests should be event-driven (triggered by API Gateway)

#### 2. Replace Hardcoded Context with Dynamic MCPs
Claude-Code currently relies on a static CLAUDE.md memory system.
Instead, MCP-based querying should replace static memory:
- Fetch repo state dynamically from GitHub
- Retrieve issue details via JIRA/Linear APIs
- Query CI/CD logs from Jenkins/GitHub Actions

#### 3. Enable Cloud-Based Code Execution
Instead of executing everything locally via REPL, Claude-Code should be able to:
- Spin up cloud test instances (AWS, GCP, Firebase)
- Deploy and fetch preview URLs for UI validation
- Trigger Selenium/Playwright UI tests

#### 4. Real-Time Streaming of Execution Logs
- Claude-Code currently returns responses synchronously (request → response)
- We need continuous output streaming to the Web Dashboard
- Each execution step, log, and user interaction should be instantly logged

#### 5. Introduce Multi-Step Execution & Auto-Correction
- The current Claude-Code responds to single queries without follow-ups
- The agent should iterate autonomously, retrying failures & self-correcting

#### 6. Handle User Approvals in Long-Running Workflows
- Inject approval pauses (if needed) instead of assuming single-shot execution
- Ping users via Slack, GitHub comments, or Web Dashboard for confirmation
- Resume execution once approval is received

#### 7. Extend Claude-Code with CI/CD and PR Automation
The agent should be able to:
- Auto-create PRs and add inline comments
- Wait for CI/CD validation before finalizing commits
- Trigger rollback mechanisms if tests fail

### High-Level System Components

1. **API Gateway**: Accepts requests from Slack, GitHub, Linear, JIRA, or direct API calls
2. **Scripta-Agent Core**: Autonomous code executor handling context aggregation, code execution, testing, preview deployment
3. **MCP Context Providers**: Dynamic data retrieval from GitHub, JIRA/Linear, CI/CD, Cloud services
4. **Repository Cache**: Efficient repository management with shallow cloning + delta updates
5. **Cloud Test Environment**: Deploys test builds for preview and automated testing
6. **CI/CD Pipeline**: Automated validation and deployment
7. **Web Dashboard**: Real-time execution viewer and control interface

### Architectural Evolution

#### Current Architecture (CLI-based REPL)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Terminal Interface                        │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                            REPL Loop                             │
│                         (src/screens/REPL.tsx)                   │
└───────────────┬─────────────────────────────────┬───────────────┘
                │                                 │
                ▼                                 ▼
┌───────────────────────────────┐  ┌───────────────────────────────┐
│         Message Processor     │  │         Command Handler        │
│       (src/utils/messages.tsx)│  │        (src/commands.ts)       │
└───────────────┬───────────────┘  └───────────────┬───────────────┘
                │                                  │
                ▼                                  ▼
┌───────────────────────────────┐  ┌───────────────────────────────┐
│          Query Pipeline       │  │        Tool Execution          │
│          (src/query.ts)       │  │         (src/tools.ts)         │
└───────────────┬───────────────┘  └───────────────┬───────────────┘
                │                                  │
                ▼                                  ▼
┌───────────────────────────────┐  ┌───────────────────────────────┐
│          Claude API           │  │      Local Filesystem/Bash     │
│       (src/services/claude.ts)│  │                                │
└───────────────────────────────┘  └───────────────────────────────┘
```

#### Phase 1-2: API-First with Persistence

```
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│  CLI Interface │  │   API Server   │  │ Test Harness   │
└───────┬────────┘  └───────┬────────┘  └───────┬────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    Execution Engine                     │
│                   (src/core/engine.ts)                  │
└─────────────┬────────────────────────────┬─────────────┘
              │                            │
              ▼                            ▼
┌─────────────────────────┐  ┌─────────────────────────────┐
│     Query Pipeline      │  │      Session Manager        │
│                         │  │                             │
└─────────────┬───────────┘  └─────────────┬───────────────┘
              │                            │
              ▼                            ▼
┌─────────────────────────┐  ┌─────────────────────────────┐
│      Tool Registry      │  │     Persistence Layer       │
│                         │  │      (Database/Cache)       │
└─────────────────────────┘  └─────────────────────────────┘
```

#### Phase 3-4: Multi-Source Input + Dynamic MCPs

```
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│   Slack    │ │   GitHub   │ │   Linear   │ │    JIRA    │
└─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘
      │              │              │              │
      └──────────────┼──────────────┼──────────────┘
                     │              │
                     ▼              ▼
    ┌────────────────────────┐    ┌────────────────────────┐
    │     API Gateway        │    │    MCP Context Hub     │
    │  (Request Normalizer)  │    │   (Dynamic Context)    │
    └────────────┬───────────┘    └────────────┬───────────┘
                 │                              │
                 │                              │
    ┌────────────▼───────────────────────────────▼─────────┐
    │                   Execution Engine                   │
    │            (Stateful Session Processing)             │
    └────────────┬───────────────────────────────┬─────────┘
                 │                               │
                 ▼                               ▼
    ┌────────────────────────┐    ┌────────────────────────┐
    │  Repository Manager    │    │    Tool Execution      │
    │     (Cache/Clone)      │    │     Environment        │
    └────────────────────────┘    └────────────────────────┘
```

#### Phase 5-6: Cloud Execution + Web Dashboard

```
┌───────────────────────────────────────────────────────────┐
│                     Web Dashboard                         │
│          (Real-time monitoring & intervention)            │
└───────────┬───────────────────────────────┬───────────────┘
            │                               │
            ▼                               ▼
┌───────────────────────┐    ┌───────────────────────────────┐
│   Event Streaming     │    │     User Management &         │
│   (WebSockets/SSE)    │    │      Authentication           │
└───────────┬───────────┘    └───────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────┐
│                Scripta-Agent Core                         │
│          (Execution Engine + Session Manager)             │
└───────────┬───────────────────────────────┬───────────────┘
            │                               │
            ▼                               ▼
┌───────────────────────┐    ┌───────────────────────────────┐
│  Containerized        │    │        Cloud Testing          │
│  Execution            │    │        Environment            │
└───────────┬───────────┘    └───────────────┬───────────────┘
            │                                │
            ▼                                ▼
┌───────────────────────┐    ┌───────────────────────────────┐
│     Tool Registry     │    │      Preview Deployment       │
│                       │    │      (Vercel, Netlify)        │
└───────────────────────┘    └───────────────────────────────┘
```

#### Phase 7-8: Workflow Orchestration + CI/CD Integration

```
┌─────────────────────────────────────────────────────────────────┐
│                     Complete Scripta-Agent                      │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
      ┌───────────────────────────┼───────────────────────────┐
      │                           │                           │
      ▼                           ▼                           ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Workflow      │     │    Execution    │     │     CI/CD       │
│  Orchestration  │     │     Engine      │     │   Integration   │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Auto-Correction│     │    Context      │     │  Deployment     │
│   Strategies    │     │ Providers (MCP) │     │  Automation     │
└─────────────────┘     └─────────────────┘     └─────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      Integration Layer                          │
└─────────┬─────────────────┬─────────────────┬─────────┬─────────┘
          │                 │                 │         │
          ▼                 ▼                 ▼         ▼
    ┌──────────┐     ┌──────────┐      ┌──────────┐  ┌──────────┐
    │ GitHub   │     │ CI Tools │      │ Cloud    │  │ Testing  │
    │ API      │     │ (Actions)│      │ Providers│  │ Tools    │
    └──────────┘     └──────────┘      └──────────┘  └──────────┘
```

### Final Target Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Request Sources                           │
│    (Slack, GitHub, Linear, JIRA, Direct API, CLI Interface)      │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                         API Gateway                              │
│           (Authentication, Normalization, Routing)               │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Scripta-Agent Core                          │
│     (Workflow Orchestration, Execution Engine, Sessions)         │
└───────────┬─────────────────────┬────────────────┬───────────────┘
            │                     │                │
            ▼                     ▼                ▼
┌───────────────────┐   ┌─────────────────┐  ┌────────────────────┐
│  MCP Context Hub  │   │ Repository Cache│  │  Cloud Execution   │
│  (Dynamic Data)   │   │ (Efficient Git) │  │  Environment       │
└───────────────────┘   └─────────────────┘  └────────────────────┘
            │                     │                │
            │                     │                │
┌───────────────────────────────────────────────────────────────────┐
│                     Integration Layer                             │
│  (GitHub, JIRA, CI/CD, Cloud providers, Testing frameworks)       │
└───────────────────────────────────────────────────────────────────┘
            │                     │                │
            ▼                     ▼                ▼
┌───────────────────┐   ┌─────────────────┐  ┌────────────────────┐
│ CI/CD Pipeline    │   │ Preview         │  │ Testing            │
│ Integration       │   │ Environments    │  │ Frameworks         │
└───────────────────┘   └─────────────────┘  └────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                        Web Dashboard                             │
│     (Real-time Monitoring, User Intervention, Approvals)         │
└──────────────────────────────────────────────────────────────────┘
```

## 2. Phased Implementation Plan

The transformation from CLI-based system to autonomous agent will proceed in 8 phases. Each phase builds on the previous one and includes verification steps.

### Phase 1: API-First Architecture

**Goal:** Transform the REPL loop into an API-driven service while maintaining current functionality.

#### Implementation Steps:

1. **Create API Entrypoint**
   - Implement Express/Fastify server in `src/entrypoints/api.ts`
   - Add authentication and request validation 
   - Create endpoints for text-based requests and setup

2. **Extract Core Logic from REPL**
   - Refactor `src/screens/REPL.tsx` to separate UI from core logic
   - Create `src/core/engine.ts` for UI-independent execution
   - Implement message processing and tool execution abstractions

3. **Make Execution Context-Independent**
   - Refactor tools to work with provided paths rather than current working directory
   - Implement repository cloning/loading as part of execution context

#### Current Status:
- ✅ Core engine implementation
- ✅ Message processor
- ✅ Tool executor
- ✅ API server
- ✅ Session management (in-memory)
- ✅ Setup endpoints
- ❌ Update error handling with proper error codes
- ❌ Add comprehensive tests for core engine
- ❌ Add API request logging
- ❌ Implement response streaming
- ❌ Add API rate limiting
- ❌ Align CLI implementation with core engine

#### Detailed Implementation Plan for Phase 1

##### Project Structure Changes

**New Files Created:**
- `src/entrypoints/api.ts` - Express/Fastify API server entrypoint
- `src/core/engine.ts` - Core execution engine independent of UI
- `src/core/messageProcessor.ts` - UI-independent message processing
- `src/core/toolExecutor.ts` - Tool execution abstraction
- `src/services/apiRoutes.ts` - API route definitions
- `src/services/auth.ts` - API authentication middleware
- `src/services/validation.ts` - Request validation middleware

**Files Refactored:**
- `src/screens/REPL.tsx` - Separated UI from core logic
- `src/query.ts` - Extracted Claude API interaction logic
- `src/utils/messages.tsx` - Removed UI dependencies
- `src/entrypoints/cli.tsx` - Updated to use new core engine

##### Core Engine Implementation

The core engine (`src/core/engine.ts`) is the central component that powers both the CLI and API interfaces. It handles:

- Processing user inputs (commands, bash commands, regular messages)
- Executing queries against the Claude API
- Managing tool execution
- Handling errors consistently

Key interfaces include:

```typescript
export interface ExecutionContext {
  workingDirectory: string;
  sessionId?: string;
  tools: Tool[];
  messages: Message[];
  systemPrompt: string[];
  additionalContext: { [k: string]: string };
  commands?: Map<string, Command>;
  canUseTool?: CanUseToolFn;
  toolUseContext?: Partial<ToolUseContext>;
}

export interface ExecutionResult {
  response: Message;
  toolUses?: any[];
  error?: Error;
}

export async function executeQuery(
  input: string,
  context: ExecutionContext
): Promise<ExecutionResult>;
```

##### Message Processor

The message processor (`src/core/messageProcessor.ts`) handles parsing and normalizing user inputs. It's UI-independent and can be used by both CLI and API interfaces:

```typescript
export enum MessageType {
  COMMAND = 'command',
  BASH = 'bash',
  REGULAR = 'regular',
}

export interface ProcessedMessage {
  type: MessageType;
  content: string;
  command?: string;
  args?: string[];
  commandPrefix?: string;
}

export function processMessage(
  input: string,
  context: ExecutionContext
): ProcessedMessage;

export function createMessageFromProcessed(
  processedMessage: ProcessedMessage
): UserMessage;
```

##### Tool Executor

The tool executor (`src/core/toolExecutor.ts`) provides a clean abstraction for executing tools and handling permissions:

```typescript
export interface ToolExecutionResult {
  success: boolean;
  message: any;
  data?: any;
  error?: Error;
}

export async function executeTool<T>(
  tool: Tool,
  input: T,
  context: ExecutionContext,
  assistantMessage: AssistantMessage,
  toolUseId?: string,
): Promise<ToolExecutionResult>;

export async function executeToolsConcurrently(
  toolExecutions: Array<{
    tool: Tool;
    input: any;
    assistantMessage: AssistantMessage;
    toolUseId?: string;
  }>,
  context: ExecutionContext
): Promise<ToolExecutionResult[]>;
```

##### API Server Implementation

The API server (`src/entrypoints/api.ts`) provides RESTful endpoints for:

1. Sending messages to Claude
2. Managing sessions
3. Setting up and configuring the system
4. Listing available tools

The server includes:
- Authentication middleware
- Request validation
- Error handling
- Session management

##### Testing Strategy

The testing strategy for Phase 1 includes:

1. **Functional Testing**
   - Test cases covering common user interactions
   - Tests against both CLI and API to ensure parity
   - Response comparison between interfaces

2. **API Testing**
   - Postman/curl tests for all endpoints
   - Authentication, validation, and error handling verification
   - Session persistence testing

3. **Integration Testing**
   - Multi-step workflows via API
   - Performance testing under various loads
   - Tool execution verification

##### Verification Steps

To verify Phase 1 implementation, the following success criteria must be met:

1. API server handles the same requests as the CLI
2. All existing tools work through both interfaces
3. The CLI maintains the same user experience
4. Code structure is cleanly separated between core logic and UI
5. Test coverage is adequate to verify functionality
6. Performance is comparable to or better than the original implementation

### Phase 2: Persistence Layer

**Goal:** Implement state persistence across requests and repository caching.

#### Implementation Steps:

1. **Request Session Management**
   - Implement session manager to track state across multiple requests
   - Store conversation history, tool outputs, and execution state
   - Create database schema for session storage (PostgreSQL/MongoDB)

2. **Repository Cache System**
   - Implement efficient repository clone and update mechanism
   - Create cache store for repositories to avoid redundant cloning
   - Add cache invalidation and delta updating

3. **Stateful Execution Context**
   - Modify context.ts to load state from persistence layer
   - Enable resumption of incomplete tasks

#### Current Status:
- ❌ Database schema design
- ❌ Repository cache implementation
- ❌ Session persistence
- ❌ Session TTL and cleanup mechanism
- ❌ User management system
- ❌ Multi-tenant support
- ❌ Admin API endpoints

### Phase 3: Multi-Source Input Handling

**Goal:** Accept requests from multiple platforms (Slack, GitHub, Linear, JIRA).

#### Implementation Steps:

1. **API Gateway Implementation**
   - Create request normalization layer for different input formats
   - Implement platform-specific authentication and webhook handling
   - Add metadata enrichment to provide context based on source

2. **Source-Specific Parsers**
   - Create parsers for Slack messages, GitHub issues, etc.
   - Extract structured data and intent from different formats
   - Implement response formatters for each platform

3. **Input Queue Management**
   - Add request priority and queueing mechanism
   - Implement concurrent request handling with resource limits

#### Current Status:
- ❌ API gateway implementation
- ❌ Source-specific parsers (Slack, GitHub, Linear/JIRA)
- ❌ Request queue with priority support
- ❌ Metadata enrichment
- ❌ Response formatters

### Phase 4: Dynamic Context via MCPs

**Goal:** Replace static context with dynamic Model Context Protocols.

#### Implementation Steps:

1. **MCP Framework Implementation**
   - Create modular MCP framework in `src/mcps/`
   - Implement context provider interface and registry
   - Add context caching and invalidation mechanisms

2. **Core MCPs Development**
   - GitHub MCP: repo state, commits, PR history
   - JIRA/Linear MCP: issue details and project context
   - CI/CD MCP: build and test results
   - Codebase MCP: code structure and documentation

3. **Context Integration**
   - Refactor query.ts to dynamically fetch context from MCPs
   - Implement context merging and prioritization
   - Add context refresh logic based on changes

#### Current Status:
- ❌ MCP framework design
- ❌ MCP implementation for GitHub, JIRA/Linear, CI/CD
- ❌ Context merging and prioritization
- ❌ Context refresh mechanisms
- ❌ Context caching with invalidation

### Phase 5: Cloud Execution Environment

**Goal:** Enable cloud-based code execution and testing.

#### Implementation Steps:

1. **Containerized Execution Engine**
   - Create Docker-based execution environment for code operations
   - Implement secure sandboxing and resource limits
   - Set up CI/CD integration for build verification

2. **UI/Browser Testing Framework**
   - Integrate Playwright/Selenium for automated UI testing
   - Add screenshot capture and visual comparison
   - Implement cloud deployment to verification environments

3. **Preview Environment Management**
   - Create infrastructure for deploying preview instances
   - Implement URL generation and access control
   - Add cleanup and resource management

#### Current Status:
- ❌ Docker-based execution environment
- ❌ UI/Browser testing framework integration
- ❌ Preview environment deployment
- ❌ Resource management and cleanup

### Phase 6: Web Dashboard and Streaming

**Goal:** Implement real-time logging and web-based interaction.

#### Implementation Steps:

1. **Execution Log Streaming**
   - Implement event-based logging system
   - Add WebSocket/SSE endpoints for real-time updates
   - Create structured log format with execution steps

2. **Web Dashboard UI**
   - Develop React-based dashboard for viewing executions
   - Implement authentication and user management
   - Create interactive components for execution control

3. **User Intervention Points**
   - Add approval request mechanism
   - Implement execution pausing and resumption
   - Create interactive debugging tools

#### Current Status:
- ❌ Event-based logging system
- ❌ WebSocket/SSE endpoints
- ❌ Web dashboard UI
- ❌ User intervention mechanisms
- ❌ Interactive debugging tools

### Phase 7: Autonomous Workflow Orchestration

**Goal:** Enable complex multi-step workflows with auto-correction.

#### Implementation Steps:

1. **Workflow Definition System**
   - Create workflow definition format for common tasks
   - Implement workflow parser and executor
   - Add parameterization and conditional execution

2. **Auto-Correction Mechanisms**
   - Implement error detection and recovery strategies
   - Add retry logic with exponential backoff
   - Create alternate path execution for failed steps

3. **Long-Running Task Management**
   - Add task scheduling and background execution
   - Implement notifications for task completion/failure
   - Create dashboard for managing running tasks

#### Current Status:
- ❌ Workflow definition system
- ❌ Auto-correction mechanisms
- ❌ Long-running task management
- ❌ Notification system

### Phase 8: CI/CD and Deployment Integration

**Goal:** Complete the system with end-to-end deployment capabilities.

#### Implementation Steps:

1. **PR Automation**
   - Enhance Bash tool to handle advanced git operations
   - Implement PR templates and automatic labeling
   - Add code review comment generation

2. **CI/CD Pipeline Integration**
   - Create integrations with GitHub Actions, Jenkins, etc.
   - Add build status monitoring and reporting
   - Implement deployment triggers

3. **Production Deployment Guardrails**
   - Add safety checks for production deployments
   - Implement rollback mechanisms
   - Create verification steps for deployed changes

#### Current Status:
- ❌ PR automation
- ❌ CI/CD pipeline integration
- ❌ Production deployment guardrails
- ❌ Rollback mechanisms

## 3. Implementation Timeline

| Phase | Key Dependencies |
|-------|-------------------|
| 1: API-First Architecture | None |
| 2: Persistence Layer | Phase 1 |
| 3: Multi-Source Input | Phase 1, 2 |
| 4: Dynamic MCPs | Phase 2 |
| 5: Cloud Execution | Phase 2, 4 |
| 6: Web Dashboard | Phase 4 |
| 7: Workflow Orchestration | Phase 4, 5, 6 |
| 8: CI/CD Integration | Phase 5, 7 |

Total estimated timeline: 6-8 months for complete transformation, with partial functionality available after each phase.

## 4. Future Enhancements

### Auto-Configuration
- Automatic configuration based on user identity
- Environment-specific configurations
- Integration with cloud identity services

### Security Enhancements
- OAuth2 support
- Fine-grained permission system
- Audit logging for security events
- Secrets management integration

### Deployment Options
- Docker container support
- Kubernetes deployment manifests
- Serverless deployment option
- Cloud service provider integrations

## 5. API Reference for Current Implementation

### Base URL

All API endpoints are prefixed with `/api`.

### Authentication

In development mode (`NODE_ENV=development`), authentication is disabled.

In production, authentication is required using an API key that should be passed in the `x-api-key` header.

### Setup Endpoints

**Configure the API service**:

- **URL**: `/api/setup`
- **Method**: `POST`
- **Authentication**: Not required (to allow initial setup)
- **Body**: Configuration parameters including API key and model preferences

**Get current configuration**:

- **URL**: `/api/setup`
- **Method**: `GET`
- **Authentication**: Not required
- **Response**: Current configuration status

**Validate configuration**:

- **URL**: `/api/setup/validate`
- **Method**: `POST`  
- **Authentication**: Not required
- **Response**: Validation result

### Message Endpoint

Send a message to Claude and get a response.

- **URL**: `/api/message`
- **Method**: `POST`
- **Authentication**: Required (except in development)
- **Body**: Message input and optional session ID

### Session Management

- **URL**: `/api/sessions/:sessionId`
- **Method**: `GET`
- **Authentication**: Required (except in development)
- **Response**: Session information

### Tools

- **URL**: `/api/tools`
- **Method**: `GET`
- **Authentication**: Required (except in development)
- **Response**: Available tools information