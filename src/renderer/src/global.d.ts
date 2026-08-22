import type { ThreadboxApi } from '../../shared/contracts'

declare global {
  interface Window {
    threadbox: ThreadboxApi
  }
}

export {}
