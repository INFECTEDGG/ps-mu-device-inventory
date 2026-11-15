import { describe, expect, it } from 'vitest'
import { passwordValidationError } from './settingsApi'

describe('Password input', () => {
  it('requires at least twelve characters', () => {
    expect(passwordValidationError('short', 'short')).not.toBeNull()
  })
  it('rejects mismatched confirmation', () => {
    expect(passwordValidationError('verylongpassword123', 'verylongpassword124')).not.toBeNull()
  })
  it('accepts valid matching passwords', () => {
    expect(passwordValidationError('verylongpassword123', 'verylongpassword123')).toBeNull()
  })
})
