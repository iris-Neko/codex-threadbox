// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  CODEX_PRIMARY_CONTAINER,
  CODEX_SECONDARY_CONTAINER,
  findKnownCodexViewContainers
} from '../../packages/vscode/src/sidebar-location'

describe('VS Code sidebar location', () => {
  it('detects both known Codex containers across contribution locations', () => {
    expect(findKnownCodexViewContainers({
      contributes: {
        viewsContainers: {
          activitybar: [{ id: CODEX_PRIMARY_CONTAINER }],
          secondarySidebar: [{ id: CODEX_SECONDARY_CONTAINER }]
        }
      }
    })).toEqual([CODEX_PRIMARY_CONTAINER, CODEX_SECONDARY_CONTAINER])
  })

  it('returns only available known containers', () => {
    expect(findKnownCodexViewContainers({
      contributes: { viewsContainers: { secondarySidebar: [{ id: CODEX_SECONDARY_CONTAINER }] } }
    })).toEqual([CODEX_SECONDARY_CONTAINER])
  })

  it('ignores unknown and malformed contributions', () => {
    expect(findKnownCodexViewContainers({
      contributes: { viewsContainers: { activitybar: [{ id: 'futureCodexContainer' }] } }
    })).toEqual([])
    expect(findKnownCodexViewContainers({ contributes: { viewsContainers: null } })).toEqual([])
    expect(findKnownCodexViewContainers(null)).toEqual([])
  })
})
