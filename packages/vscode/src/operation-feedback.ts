import type { BatchOperationResult } from '../../../src/shared/contracts'

export function isWriterConflict(message: string): boolean {
  return /already has an active writer/iu.test(message)
}

function reason(message: string, chinese: boolean): string {
  if (isWriterConflict(message)) return chinese
    ? '任务仍被 Codex 或另一个应用打开。请在原应用归档，或退出该应用后再重试。'
    : 'This task is still open in Codex or another app. Archive it there, or exit that app before retrying.'
  if (!chinese) return message
  if (/Pinned threads must be unpinned/.test(message)) return '任务已置顶，请先取消置顶。'
  if (/Active threads cannot/.test(message)) return '任务正在运行，请等待完成或先在 Codex 中停止。'
  if (/spawned descendant.*active or pinned/.test(message)) return '有子任务正在运行或已置顶，请先处理子任务。'
  if (/already in Trash/.test(message)) return '任务已经在垃圾箱中。'
  if (/(Task|Thread) was not found/.test(message)) return '任务已不存在，请刷新列表。'
  return message
}

function batchSummary(result: BatchOperationResult, locale: string): string {
  const chinese = locale.toLowerCase().startsWith('zh')
  return chinese
    ? '成功 ' + result.succeeded.length + '，失败 ' + result.failed.length + '，跳过 ' + result.skipped.length + '。'
    : result.succeeded.length + ' succeeded, ' + result.failed.length + ' failed, ' + result.skipped.length + ' skipped.'
}

export function batchFeedback(result: BatchOperationResult, locale: string): string {
  const chinese = locale.toLowerCase().startsWith('zh')
  const summary = batchSummary(result, locale)
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

export function batchNotice(
  result: BatchOperationResult,
  locale: string,
  titles: ReadonlyMap<string, string>
): { message: string; details: string; lockedIds: string[] } {
  const issues = [...result.failed, ...result.skipped]
  const first = issues[0]
  const chinese = locale.toLowerCase().startsWith('zh')
  const title = first ? titles.get(first.id)?.replace(/[\r\n]/gu, ' ').slice(0, 80) : undefined
  const details = [batchSummary(result, locale), ...issues.map((issue) =>
    (titles.get(issue.id) ?? '') + ' [' + issue.id + ']\n' + issue.message)]
  return {
    message: first ? (title ? title + ': ' : '') + reason(first.message, chinese) : batchFeedback(result, locale),
    details: details.join('\n\n'),
    lockedIds: [...new Set(issues.filter((issue) => isWriterConflict(issue.message)).map((issue) => issue.id))]
  }
}
