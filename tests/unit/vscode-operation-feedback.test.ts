// @vitest-environment node
import { expect, it } from 'vitest'
import { batchFeedback, batchNotice } from '../../packages/vscode/src/operation-feedback'

it('explains why a task was not moved instead of showing only counts', () => {
  const message = batchFeedback({
    succeeded: ['ok'], failed: [{ id: 'broken', message: 'no rollout found' }],
    skipped: [{ id: 'pinned', message: 'Pinned threads must be unpinned before deletion.' }],
    cascadedCount: 0, refreshedAt: 1
  }, 'zh-CN')
  expect(message).toContain('成功 1')
  expect(message).toContain('broken: no rollout found')
  expect(message).toContain('请先取消置顶')
})

it('puts the lock explanation before task IDs and retains every full error in details', () => {
  const issues = Array.from({ length: 8 }, (_, index) => ({
    id: 'locked-' + index, message: 'thread locked-' + index + ' already has an active writer'
  }))
  const notice = batchNotice({
    succeeded: [], failed: issues, skipped: [], cascadedCount: 0, refreshedAt: 1
  }, 'zh-CN', new Map([['locked-0', 'exit']]))
  expect(notice.message).toBe('exit: 任务仍被 Codex 或另一个应用打开。请在原应用归档，或退出该应用后再重试。')
  expect(notice.message).not.toContain('locked-0')
  expect(notice.details).toContain('thread locked-7 already has an active writer')
  expect(notice.lockedIds).toHaveLength(8)
})
