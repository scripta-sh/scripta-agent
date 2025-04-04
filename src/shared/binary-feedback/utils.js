import { logEvent } from '../../services/statsig.js';

/**
 * Core binary feedback utilities
 * Extracted from CLI-specific implementation
 */

export async function shouldUseBinaryFeedback() {
  if (process.env.DISABLE_BINARY_FEEDBACK) {
    logBinaryFeedbackSamplingDecision(false, 'disabled_by_env_var');
    return false;
  }
  if (process.env.FORCE_BINARY_FEEDBACK) {
    logBinaryFeedbackSamplingDecision(true, 'forced_by_env_var');
    return true;
  }
  if (process.env.USER_TYPE !== 'ant') {
    logBinaryFeedbackSamplingDecision(false, 'not_ant');
    return false;
  }
  if (process.env.NODE_ENV === 'test') {
    logBinaryFeedbackSamplingDecision(false, 'test');
    return false;
  }
  
  return false;
}

export async function logBinaryFeedbackSamplingDecision(
  decision,
  reason
) {
  logEvent('tengu_binary_feedback_sampling_decision', {
    decision: decision.toString(),
    reason,
  });
}

export function messagePairValidForBinaryFeedback(m1, m2) {
  return true;
}
