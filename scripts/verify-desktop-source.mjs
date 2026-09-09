import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const tag = process.env.RELEASE_TAG
const runId = process.env.SOURCE_RUN_ID
const repository = process.env.GITHUB_REPOSITORY
if (tag !== `v${version}` || !/^v\d+\.\d+\.\d+$/.test(tag) || !/^\d+$/.test(runId ?? '')) {
  throw new Error('Invalid desktop release tag or artifact run ID.')
}
const gh = (...args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }))
let ref = gh('api', `repos/${repository}/git/ref/tags/${tag}`).object
for (let depth = 0; ref.type === 'tag' && depth < 5; depth++) {
  ref = gh('api', `repos/${repository}/git/tags/${ref.sha}`).object
}
const run = gh('run', 'view', runId, '--repo', repository, '--json', 'headSha,jobs')
if (ref.type !== 'commit' || ref.sha !== run.headSha) throw new Error('Artifact commit does not match the release tag.')
for (const name of ['Desktop windows-x64', 'Desktop macos-x64-arm64', 'Desktop linux-x64']) {
  if (!run.jobs.some((job) => job.name === name && job.conclusion === 'success')) {
    throw new Error(`Required platform verification did not pass: ${name}`)
  }
}
console.log(`Verified ${tag}: all platform jobs passed for commit ${ref.sha}.`)
