import { Request, Response, NextFunction } from 'express'
import { getConfig } from '../core/config'
import { logEvent } from './statsig'

/**
 * Authentication middleware for API requests
 * This is a basic implementation that will be enhanced in future phases
 */
export function authenticateRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Get the API key from the request headers
  const apiKey = req.headers['x-api-key'] as string
  
  // Check if an API key is required
  const config = getConfig()
  const requireApiKey = config.requireApiKey !== false
  
  // If no API key is required or we're in development, skip authentication
  if (!requireApiKey || process.env.NODE_ENV === 'development') {
    return next()
  }
  
  // Check if an API key was provided
  if (!apiKey) {
    logEvent('api_auth_failed', { reason: 'missing_api_key' })
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API key is required',
    })
  }
  
  // Validate the API key 
  // In a real implementation, this would check against a database
  // For now, we'll use a simple check against a configured key
  const validApiKey = config.apiKey
  
  if (apiKey !== validApiKey) {
    logEvent('api_auth_failed', { reason: 'invalid_api_key' })
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key',
    })
  }
  
  // API key is valid, proceed with the request
  next()
}

/**
 * Check if a request is authorized to access a specific resource
 * This can be used for more fine-grained authorization in the future
 */
export function isAuthorized(
  req: Request,
  resource: string,
  action: string
): boolean {
  // In the future, this would check permissions based on the authenticated user
  // For now, we'll just return true for all authorized requests
  return true
}