import { Request, Response, NextFunction } from 'express'
import { z, ZodSchema } from 'zod'
import { logEvent } from './statsig'

/**
 * Basic validation options for the validation middleware
 */
interface ValidationOptions {
  /** Location of the data in the request to validate */
  source?: 'body' | 'query' | 'params';
  /** Custom error message */
  errorMessage?: string;
}

/**
 * Schema map for validating different endpoints
 */
const schemaMap = new Map<string, ZodSchema>()

// Add schemas for different endpoints
schemaMap.set('/api/message', z.object({
  input: z.string().min(1),
  sessionId: z.string().optional(),
  contextParams: z.object({
    workingDirectory: z.string().optional(),
  }).optional(),
}))

/**
 * Middleware for validating request data
 */
export function validateRequest(
  req: Request, 
  res: Response, 
  next: NextFunction,
  options: ValidationOptions = {}
): void {
  // Default options
  const { 
    source = 'body',
    errorMessage = 'Invalid request data',
  } = options
  
  // Get the schema for this endpoint
  const url = req.originalUrl.split('?')[0]
  const schema = schemaMap.get(url)
  
  // If no schema exists, skip validation
  if (!schema) {
    return next()
  }
  
  // Get the data to validate based on the source
  const data = req[source]
  
  // Validate the data against the schema
  const validationResult = schema.safeParse(data)
  
  if (!validationResult.success) {
    // Log validation failure
    logEvent('api_validation_failed', {
      url,
      error: JSON.stringify(validationResult.error.format()),
    })
    
    // Send validation error response
    return res.status(400).json({
      error: errorMessage,
      details: validationResult.error.format(),
    })
  }
  
  // Validation passed, continue
  next()
}

/**
 * Validate workspaces for file operations
 * Makes sure paths are within allowed directories
 */
export function validateWorkspacePath(
  workspace: string,
  path: string
): boolean {
  // Normalize paths for comparison
  const normalizedWorkspace = workspace.endsWith('/') 
    ? workspace 
    : `${workspace}/`
  
  const normalizedPath = path.startsWith('/') 
    ? path 
    : `/${path}`
  
  // Check if the path is within the workspace
  return normalizedPath.startsWith(normalizedWorkspace)
}