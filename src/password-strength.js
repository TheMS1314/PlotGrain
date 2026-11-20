import { ZxcvbnFactory } from '@zxcvbn-ts/core'
import { adjacencyGraphs, dictionary } from '@zxcvbn-ts/language-common'

const estimator = new ZxcvbnFactory({ graphs: adjacencyGraphs, dictionary })
export const minimumPasswordLength = 15
export const maximumPasswordLength = 128

export function passwordFeedback(password, email = '') {
  const length = [...password].length
  if (length < minimumPasswordLength) return 'Use at least 15 characters.'
  if (password.length > maximumPasswordLength) return 'Use at most 128 characters.'
  const address = typeof email === 'string' ? email.trim().toLowerCase() : ''
  const score = estimator.check(password, address ? [address, address.split('@')[0]] : []).score
  return score >= 3 ? '' : 'Choose a less predictable password. Try several unrelated words.'
}
