import type { BatchOperationResult } from '../../../src/shared/contracts'

function reason(message: string, chinese: boolean): string {
  if (!chinese) return message
  if (/Pinned threads must be unpinned/.test(message)) return '任务已置顶，请先取消置顶。'
  if (/Active threads cannot/.test(message)) return '任务正在运行，请等待完成或先在 Codex 中停止。'
  if (/spawned descendant.*active or pinned/.test(message)) return '有子任务正在运行或已置顶，请先处理子任务。'
  if (/already in Trash/.test(message)) return '任务已经在垃圾箱中。'
  if (/(Task|Thread) was not found/.test(message)) return '任务已不存在，请刷新列表。'
  return message
}

export function batchFeedback(result: BatchOperationResult, locale: string): string {
  const chinese = locale.toLowerCase().startsWith('zh')
  const summary = chinese
    ? '成功 ' + result.succeeded.length + '，失败 ' + result.failed.length + '，跳过 ' + result.skipped.length + '。'
    : result.succeeded.length + ' succeeded, ' + result.failed.length + ' failed, ' + result.skipped.length + ' skipped.'
  const issues = [...result.failed, ...result.skipped]
  const details = issues.slice(0, 5).map((issue) => issue.id + ': ' + reason(issue.message, chinese))
  if (issues.length > 5) details.push(chinese ? '另有 ' + (issues.length - 5) + ' 项。' : (issues.length - 5) + ' more issues.')
  return [summary, ...details].join('\n')
}

export class ProjectAssignmentError extends Error {
  constructor(readonly result: BatchOperationResult) {
    super(batchFeedback(result, 'en'))
  }
}
