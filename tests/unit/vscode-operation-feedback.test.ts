// @vitest-environment node
import { expect, it } from 'vitest'
import { batchFeedback } from '../../packages/vscode/src/operation-feedback'

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
