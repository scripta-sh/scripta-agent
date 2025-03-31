// Memory Read Tool prompt and description
export const PROMPT = `
- Reads files from a persistent memory directory
- Can read specific memory files or list all available memories
- The memory directory persists across sessions 
- Use this to retrieve previously stored information
`

export const DESCRIPTION = `
Reads data from the persistent memory directory. This allows you to retrieve information stored
across different sessions. You can either read a specific file by providing its path, or get
a listing of all available memory files if no path is provided.
`