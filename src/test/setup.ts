import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest runs with globals off, so Testing Library cannot register its own
// afterEach cleanup; without this, renders leak between tests.
afterEach(cleanup)

// A console step is a save, a send and a reload; under two parallel workers
// that can pass the 1 s default. Waiting longer only slows a failing test.
configure({ asyncUtilTimeout: 5000 })
