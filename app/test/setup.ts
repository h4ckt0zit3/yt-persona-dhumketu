import '@testing-library/jest-dom/vitest'
import { vi, beforeEach } from 'vitest'

// Reset all mocks between tests so test order doesn't matter.
beforeEach(() => {
  vi.restoreAllMocks()
})
