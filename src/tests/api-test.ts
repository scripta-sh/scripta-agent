/**
 * Simple script to test the Scripta-Agent API
 * Run with: NODE_ENV=development tsx src/tests/api-test.ts
 */

import { config } from 'dotenv'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import fetch from 'node-fetch'

// Load environment variables from .env.dev file
config({ path: path.resolve(process.cwd(), '.env.dev') })
console.log('Loaded API key from .env.dev for testing')

// API base URL
const API_URL = 'http://localhost:3000/api'

// Test the API
async function testAPI() {
  try {
    console.log('🧪 Testing Scripta-Agent API...')
    
    // 1. Health check
    console.log('\n1. Testing health endpoint...')
    const healthResponse = await fetch('http://localhost:3000/')
    const healthData = await healthResponse.json()
    console.log('Health response:', healthData)
    
    // 2. Testing setup endpoints
    console.log('\n2. Testing setup endpoints...')
    
    // 2.1 Get current config
    console.log('2.1 Getting current config...')
    const configResponse = await fetch(`${API_URL}/setup`)
    const configData = await configResponse.json()
    console.log('Current config:', configData)
    
    // 2.2 Update config
    console.log('2.2 Updating config...')
    const testConfig = {
      apiKey: process.env.ANTHROPIC_API_KEY, // Use API key from .env.dev
      model: 'claude-3-haiku-20240307',
      requireApiKey: false,
      trustTools: ['BashTool', 'FileReadTool']
    }
    
    const updateConfigResponse = await fetch(`${API_URL}/setup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testConfig),
    })
    
    const updateConfigData = await updateConfigResponse.json()
    console.log('Update config response:', updateConfigData)
    
    // 2.3 Validate config
    console.log('2.3 Validating config...')
    const validateConfigResponse = await fetch(`${API_URL}/setup/validate`, {
      method: 'POST',
    })
    
    const validateConfigData = await validateConfigResponse.json()
    console.log('Validate config response:', validateConfigData)
    
    // 3. Create a new session
    console.log('\n3. Creating a new session...')
    const sessionId = uuidv4()
    console.log('Generated session ID:', sessionId)
    
    // 4. Send a simple message
    console.log('\n4. Sending a test message...')
    
    try {
      const messageResponse = await fetch(`${API_URL}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: 'Hello, I am testing the API. What is your name?',
          sessionId,
        }),
      })
      
      const messageData = await messageResponse.json()
      console.log('Message response:', JSON.stringify(messageData, null, 2))
      
      // Check if response structure is valid
      if (messageData?.response?.type) {
        console.log('Message response type:', messageData.response.type)
        console.log('Message content:', messageData.response.message?.content?.[0]?.text || 'No content')
      } else {
        console.log('WARNING: Unexpected response structure. This may be due to missing API key.')
        console.log('For complete testing, configure an API key in your .scripta/config.json file')
      }
    } catch (msgError) {
      console.log('⚠️ Message test failed, but continuing test:', msgError)
      console.log('This may be expected if no API key is configured.')
    }
    
    // 5. Get session info
    console.log('\n5. Getting session info...')
    const sessionResponse = await fetch(`${API_URL}/sessions/${sessionId}`)
    const sessionData = await sessionResponse.json()
    console.log('Session data:', sessionData)
    
    // 6. List all sessions
    console.log('\n6. Listing all sessions...')
    const sessionsResponse = await fetch(`${API_URL}/sessions`)
    const sessionsData = await sessionsResponse.json()
    console.log('Sessions count:', sessionsData.sessions.length)
    
    // 7. Get available tools
    console.log('\n7. Getting available tools...')
    const toolsResponse = await fetch(`${API_URL}/tools`)
    const toolsData = await toolsResponse.json()
    console.log('Available tools count:', toolsData.tools.length)
    console.log('First few tools:', toolsData.tools.slice(0, 3).map((t: any) => t.name))
    
    // 8. Try a tool-using message
    console.log('\n8. Sending a message that might use tools...')
    try {
      const toolMessageResponse = await fetch(`${API_URL}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: 'What files are in the current directory?',
          sessionId,
        }),
      })
      
      const toolMessageData = await toolMessageResponse.json()
      if (toolMessageData?.response?.type) {
        console.log('Tool message response type:', toolMessageData.response.type)
        console.log('Tool uses count:', (toolMessageData.toolUses || []).length)
        console.log('Response content:', toolMessageData.response.message?.content?.[0]?.text || 'No content')
      } else {
        console.log('WARNING: Tool message returned invalid structure')
      }
    } catch (toolMsgError) {
      console.log('⚠️ Tool message test failed, but continuing test:', toolMsgError)
    }
    
    console.log('\n✅ API test completed successfully!')
  } catch (error) {
    console.error('❌ API test failed:', error)
    throw error
  }
}

// Check if server is running
async function checkServerRunning() {
  try {
    await fetch('http://localhost:3000/')
    return true
  } catch (error) {
    return false
  }
}

// Main function
async function main() {
  const isServerRunning = await checkServerRunning()
  
  if (!isServerRunning) {
    console.error('❌ API server is not running! Please start it with: pnpm run api:start')
    process.exit(1)
  }
  
  try {
    await testAPI()
  } catch (error) {
    console.error('Test failed with error:', error)
    process.exit(1)
  }
}

// Run the main function
main()