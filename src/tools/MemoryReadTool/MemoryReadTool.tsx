import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { Box, Text } from 'ink'
import { join } from 'path'
import * as React from 'react'
import { z } from 'zod'
import { FallbackToolUseRejectedMessage } from '../../components/FallbackToolUseRejectedMessage'
import { Tool } from '../../Tool'
import { MEMORY_DIR } from '../../utils/env'
import { DESCRIPTION, PROMPT } from './prompt'

const inputSchema = z.strictObject({
  file_path: z
    .string()
    .optional()
    .describe('Optional path to a specific memory file to read'),
})

export const MemoryReadTool = {
  name: 'MemoryRead',
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  inputSchema,
  userFacingName() {
    return 'Read Memory'
  },
  async isEnabled() {
    // TODO: Use a statsig gate
    // TODO: Figure out how to do that without regressing app startup perf
    return false
  },
  isReadOnly() {
    return true
  },
  needsPermissions() {
    return false
  },
  renderResultForAssistant({ content }) {
    return content
  },
  async validateInput({ file_path }) {
    if (file_path) {
      const fullPath = join(MEMORY_DIR, file_path)
      if (!fullPath.startsWith(MEMORY_DIR)) {
        return { result: false, message: 'Invalid memory file path' }
      }
      if (!existsSync(fullPath)) {
        return { result: false, message: 'Memory file does not exist' }
      }
    }
    return { result: true }
  },
  async *call({ file_path }) {
    mkdirSync(MEMORY_DIR, { recursive: true })

    // If a specific file is requested, return its contents
    if (file_path) {
      const fullPath = join(MEMORY_DIR, file_path)
      if (!existsSync(fullPath)) {
        throw new Error('Memory file does not exist')
      }
      const content = readFileSync(fullPath, 'utf-8')
      yield {
        type: 'result',
        data: {
          content,
        },
        resultForAssistant: this.renderResultForAssistant({ content }),
      }
      return
    }

    // Otherwise return the index and file list
    const files = readdirSync(MEMORY_DIR, { recursive: true })
      .map(f => join(MEMORY_DIR, f.toString()))
      .filter(f => !lstatSync(f).isDirectory())
      .map(f => `- ${f}`)
      .join('\n')

    const indexPath = join(MEMORY_DIR, 'index.md')
    const index = existsSync(indexPath) ? readFileSync(indexPath, 'utf-8') : ''

    const quotes = "'''"
    const content = `Here are the contents of the root memory file, \`${indexPath}\`:
${quotes}
${index}
${quotes}

Files in the memory directory:
${files}`
    yield {
      type: 'result',
      data: { content },
      resultForAssistant: this.renderResultForAssistant({ content }),
    }
  },
} satisfies Tool<typeof inputSchema, { content: string }>
