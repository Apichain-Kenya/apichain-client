import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest runs with globals off, so Testing Library cannot register its own
// afterEach cleanup; without this, renders leak between tests.
afterEach(cleanup)
