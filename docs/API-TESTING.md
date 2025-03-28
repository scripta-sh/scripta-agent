# Scripta Agent API Testing Guide

## Overview
This guide provides instructions for testing the Scripta Agent API implementation from Phase 1 of our transformation plan. The API allows Scripta Agent to operate as a service independent of the CLI interface.

## Prerequisites
- Node.js v18 or higher
- pnpm installed
- Project dependencies installed (`pnpm i`)

## API Test Process

### Starting the API Server
```bash
# Run in development mode (no authentication required)
NODE_ENV=development pnpm run api

# Run in production mode (requires API key)
pnpm run api
```

The server will start on port 3000 by default. You can change this by setting the PORT environment variable.

### Running the Test Script
In a separate terminal window, run:
```bash
# Run the automated test script
./scripts/test-api.sh

# Or run the test directly
NODE_ENV=development pnpm run test:api
```

## What's Being Tested

The test script verifies the following API functionality:

1. **Health Check** - `/` endpoint returns status and version information

2. **Setup Endpoints**
   - GET `/api/setup` - Retrieves current configuration
   - POST `/api/setup` - Updates configuration settings
   - POST `/api/setup/validate` - Validates the current configuration

3. **Session Management**
   - Creating a new session with generated ID
   - Retrieving session information
   - Listing all active sessions

4. **Message Processing**
   - Sending a simple text message
   - Sending a message that uses tools

5. **Tool Management**
   - Listing all available tools
   - Verifying tool execution through messages

## Manual Testing

You can also test the API manually with curl:

```bash
# Health check
curl http://localhost:3000/

# Get current config
curl http://localhost:3000/api/setup

# Update config
curl -X POST http://localhost:3000/api/setup \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-3-haiku-20240307","requireApiKey":false}'

# Send a message
curl -X POST http://localhost:3000/api/message \
  -H "Content-Type: application/json" \
  -d '{"input":"Hello, what is your name?","sessionId":"test-session"}'

# Get session info
curl http://localhost:3000/api/sessions/test-session

# List all sessions
curl http://localhost:3000/api/sessions

# List available tools
curl http://localhost:3000/api/tools
```

## Troubleshooting

### Common Issues

1. **Server not running**
   - Ensure the API server is running on port 3000
   - Check for any error messages in the server terminal

2. **Authentication failures**
   - When not in development mode, you need to provide an API key
   - Use the `-H "X-API-Key: your-api-key"` header with curl commands

3. **Invalid requests**
   - Check the JSON structure of your request body
   - Ensure all required fields are provided

4. **Configuration issues**
   - Ensure the API has access to a valid Claude API key
   - Check that working directories are correctly specified

## Next Steps

After verifying API functionality, we can proceed to:

1. Implement proper error handling
2. Add more comprehensive tests
3. Implement response streaming
4. Begin work on Phase 2 (Persistence Layer)
