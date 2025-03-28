import express from 'express'
import cors from 'cors'
import { z } from 'zod'
import { enableConfigs } from '../utils/config'
import { logError } from '../utils/log'

// Enable config reading - this is critical for the API to work properly
// It must be called before any imports that might access the config
enableConfigs()

// Import routes after enabling config
import apiRoutes from '../services/apiRoutes'

// Initialize the Express application
const app = express()

// Configure middlewares
app.use(express.json())
app.use(cors())

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`)
  next()
})

// Use the API routes
app.use('/api', apiRoutes)

// Root endpoint for health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    name: 'Scripta-Agent API',
    version: process.env.npm_package_version || '0.0.1',
  })
})

// Add error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logError(err)
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred',
  })
})

// Start the server
const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`
========================================
🚀 Scripta-Agent API server running
📡 Port: ${port}
🔐 Auth: ${process.env.NODE_ENV === 'development' ? 'Disabled (dev mode)' : 'Enabled'}
========================================
  `)
})

export default app