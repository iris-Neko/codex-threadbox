// @vitest-environment node

import { describe, expect, it } from 'vitest'
import stringWidth from 'string-width'
import {
  filterList,
  formatThreadTable,
  listEnvelope,
  listFilters,
  operationSucceeded,
  previewEnvelope,
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
  cliVersion: '0.150.1',
  minimumVersion: '0.150.0',
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
    expect(filterList([{ ...thread, id: 'spawned', internal: true }], {})).toEqual([])
    expect(filterList([{ ...thread, id: 'spawned', internal: true }], { includeSpawned: true }))
      .toHaveLength(1)
    expect(filterList([{ ...thread, cwd: 'C:\\Work\\Demo\\' }], { cwd: 'c:/work/demo' }))
      .toHaveLength(1)
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
    expect(previewEnvelope('delete', {
      requestedIds: ['one'],
      roots: [{ id: 'one', title: 'Release review', cwd: '/workspace/release', descendantCount: 0 }],
      skipped: [],
      cascadedCount: 0,
      refreshedAt: 1
    })).toMatchObject({ schemaVersion: 1, command: 'delete', success: true, dryRun: true })
  })

  it('keeps Unicode table columns aligned', () => {
    const table = formatThreadTable([
      thread,
      { ...thread, id: 'two', title: '清理旧任务记录', cwd: 'C:\\工作区\\线程管理器' }
    ], 120)
    const lines = table.split('\n')
    expect(lines).toHaveLength(3)
    const sourceOffsets = lines.map((line, index) => {
      const marker = index === 0 ? 'SOURCE' : 'cli'
      return stringWidth(line.slice(0, line.indexOf(marker)))
    })
    expect(new Set(sourceOffsets).size).toBe(1)
    expect(lines[2]).toContain('清理旧任务记录')
  })

  it('treats skipped and failed items as a partial failure', () => {
    expect(operationSucceeded(success)).toBe(true)
    expect(operationSucceeded({ ...success, skipped: [{ id: 'one', message: 'protected' }] }))
      .toBe(false)
  })
})
