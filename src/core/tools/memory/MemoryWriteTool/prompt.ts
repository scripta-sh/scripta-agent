// Memory Write Tool prompt and description
export const PROMPT = `
- Writes data to a persistent memory directory
- Creates files and directories as needed
- The memory persists across different sessions
- Use this to store information for future reference
`

export const DESCRIPTION = `
Writes data to the persistent memory directory. This allows you to store information that will
be available across different sessions. You must provide both a file_path and the content to write.
The directories will be created automatically as needed.
`