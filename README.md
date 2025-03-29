# Scripta Agent

   _____  _____ _____  _____ _____ _______       
  / ____|/ ____|  __ \|_   _|  __ \__   __|/\    
 | (___ | |    | |__) | | | | |__) | | |  /  \   
  \___ \| |    |  _  /  | | |  ___/  | | / /\ \  
  ____) | |____| | \ \ _| |_| |      | |/ ____ \ 
 |_____/ \_____|_|  \_\_____|_|      |_/_/    \_\
                                                

Scripta Agent is an AI-driven, autonomous development agent designed to generate, review, debug, and push code with minimal human intervention. It acts as the backend engine for Scripta, a platform that accelerates software development by automating tedious engineering tasks.

## Key Features

### 🧠 Autonomous Code Generation
- Converts natural language prompts into functional code
- Implements features based on structured requests
- Generates boilerplate and scaffolding for new projects

### 🔍 Automated Code Reviews & Fixes
- Reviews pull requests (PRs) and suggests improvements
- Detects bugs, security flaws, and inefficiencies
- Auto-fixes issues and raises PRs with explanations

### 🐛 Debugging & Self-Healing Code
- Clones repositories and independently runs debugging sessions
- Analyzes logs, traces errors, and proposes fixes
- Uses external tools to find solutions

### 🚀 PR & GitHub Automation
- Automatically creates and manages pull requests
- Pushes AI-generated fixes and enhancements directly to repositories
- Supports structured commit messages and version tracking

## Installation

```
npm install -g scripta-agent
cd your-project
scripta
```

On first run, Scripta will guide you through setup and model selection. For subsequent model changes, use the `/model` command.

If you don't see the models you want on the list, you can configure custom endpoints in `/config`. Scripta supports:
- OpenAI API compatible endpoints
- Anthropic Claude models
- AWS Bedrock
- Google Vertex AI

## Commands

Scripta provides several slash commands to help you work efficiently:

- `/help` - View all available commands
- `/model` - Change AI model
- `/config` - View and edit configuration
- `/bug` - Report issues
- `/cost` - Track token usage and costs
- `/clear` - Clear the conversation

## Cost Optimization

Scripta implements cost controls to manage your AI API usage:
- Tracks token usage across conversations
- Provides cost estimates based on your selected model
- Allows setting usage thresholds and alerts

## Development

```
pnpm i
pnpm run dev
pnpm run build
```

For more detailed logs while debugging:
```
NODE_ENV=development pnpm run dev --verbose --debug
```

## Privacy & Security

- Scripta uses only the AI providers you configure
- No telemetry or data collection beyond what's needed for API calls
- All data stays local except when sent to your selected AI provider
- Configuration is stored in the `.scripta` directory in your home folder

## Acknowledgments

Scripta Agent is based on [anon-kode](https://github.com/dnakov/anon-kode) by [dnakov](https://github.com/dnakov). We are grateful for the foundation provided by this excellent project.
