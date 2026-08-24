// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadService } from '../../packages/core/src/thread-service'
import type { BatchOperationResult, ListThreadsResult, ThreadRecord } from '../../src/shared/contracts'

const prompts = vi.hoisted(() => ({
  checkbox: vi.fn(),
  confirm: vi.fn(),
  input: vi.fn(),
  select: vi.fn()
}))

vi.mock('@inquirer/prompts', async (importOriginal) => {
  const original = await importOriginal<typeof import('@inquirer/prompts')>()
  return { ...original, ...prompts }
})

import { runInteractive } from '../../packages/cli/src/interactive'

const thread: ThreadRecord = {
  id: 'one',
  title: 'Task one',
  preview: 'Preview',
  cwd: '/workspace',
  projectId: null,
  createdAt: 1,
  updatedAt: 2,
  source: 'cli',
  archived: false,
  pinned: false,
  status: 'idle',
  parentThreadId: null,
  descendantCount: 0,
  internal: false,
  ineligibleReason: null
}

function listed(pinning = false): ListThreadsResult {
  return {
    threads: [thread],
    environment: {
      state: 'ready',
      cliPath: 'codex',
      cliVersion: '0.149.0',
      minimumVersion: '0.149.0',
      message: null,
      externalCodexProcesses: 0,
      capabilities: { pinning }
    },
    desktopRecents: { state: 'unavailable', staleCount: 0, staleEntries: [], message: null },
    refreshedAt: 1
  }
}

const success: BatchOperationResult = {
  succeeded: ['one'],
  failed: [],
  skipped: [],
  cascadedCount: 0,
  refreshedAt: 1
}

function service(overrides: Partial<ThreadService> = {}): ThreadService {
  return {
    listThreads: vi.fn().mockResolvedValue(listed()),
    archiveThreads: vi.fn().mockResolvedValue(success),
    ...overrides
  } as unknown as ThreadService
}

describe('CLI interactive manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  it('keeps filters in memory and hides unsupported pin actions', async () => {
    const actions = ['search', 'spawned', 'grouping', 'refresh', 'quit']
    const actionChoices: string[][] = []
    prompts.select.mockImplementation(async (options: { message: string; choices: Array<{ value?: string }> }) => {
      if (options.message !== 'Choose an action') return 'all'
      actionChoices.push(options.choices.flatMap((choice) => choice.value ? [choice.value] : []))
      return actions.shift()
    })
    prompts.input.mockResolvedValue('Task')
    const instance = service()

    expect(await runInteractive(instance, 'en')).toBe(0)
    expect(instance.listThreads).toHaveBeenCalledTimes(2)
    expect(actionChoices[0]).not.toContain('pin')
    expect(actionChoices[0]).not.toContain('unpin')
  })

  it('refreshes the snapshot after a mutation', async () => {
    const actions = ['archive', 'quit']
    prompts.select.mockImplementation(async (options: { message: string }) =>
      options.message === 'Choose an action' ? actions.shift() : 'all'
    )
    prompts.checkbox.mockResolvedValue(['one'])
    prompts.confirm.mockResolvedValue(true)
    const instance = service()

    expect(await runInteractive(instance, 'en')).toBe(0)
    expect(instance.archiveThreads).toHaveBeenCalledWith(['one'])
    expect(instance.listThreads).toHaveBeenCalledTimes(2)
  })
})
