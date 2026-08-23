// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  filterList,
  listEnvelope,
  listFilters,
  operationSucceeded,
  resultEnvelope,
  statusEnvelope
} from '../../packages/cli/src/output'
import type {
  BatchOperationResult,
  EnvironmentStatus,
  ThreadRecord
} from '../../src/shared/contracts'

const environment: EnvironmentStatus = {
  state: 'ready',
  cliPath: 'codex',
  cliVersion: '0.149.0',
  minimumVersion: '0.149.0',
  message: null,
  externalCodexProcesses: 0,
  capabilities: { pinning: false }
}

const thread: ThreadRecord = {
  id: 'one',
  title: 'Release review',
  preview: 'Review release metadata',
  cwd: '/workspace/release',
  projectId: null,
  createdAt: 10,
  updatedAt: 20,
  source: 'cli',
  archived: false,
  pinned: false,
  status: 'idle',
  parentThreadId: null,
  descendantCount: 0,
  internal: false,
  ineligibleReason: null
}

const success: BatchOperationResult = {
  succeeded: ['one'],
  failed: [],
  skipped: [],
  cascadedCount: 0,
  refreshedAt: 1
}

describe('CLI output contract', () => {
  it('validates filters and searches metadata', () => {
    expect(() => listFilters({ state: 'deleted' })).toThrow(/State must be/)
    expect(() => listFilters({ sort: 'random' })).toThrow(/Sort must be/)
    expect(filterList([thread], { search: 'workspace/release' })).toEqual([thread])
    expect(filterList([thread], { state: 'archived' })).toEqual([])
  })

  it('emits stable schemaVersion 1 envelopes', () => {
    expect(statusEnvelope('status', environment)).toEqual({
      schemaVersion: 1,
      command: 'status',
      success: true,
      environment
    })
    expect(listEnvelope('list', environment, [thread])).toMatchObject({
      schemaVersion: 1,
      success: true,
      records: [thread]
    })
    expect(resultEnvelope('delete', true, success)).toMatchObject({
      schemaVersion: 1,
      command: 'delete',
      success: true,
      result: success
    })
  })

  it('treats skipped and failed items as a partial failure', () => {
    expect(operationSucceeded(success)).toBe(true)
    expect(operationSucceeded({ ...success, skipped: [{ id: 'one', message: 'protected' }] }))
      .toBe(false)
  })
})
