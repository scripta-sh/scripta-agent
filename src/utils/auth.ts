import { USE_BEDROCK, USE_VERTEX } from './model'
import { getGlobalConfig } from './config'

export function isAnthropicAuthEnabled(): boolean {
  return true
}

export function isLoggedInToAnthropic(): boolean {
  const config = getGlobalConfig()
  return !!config.primaryApiKey
}
