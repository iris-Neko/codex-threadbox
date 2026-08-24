import { spawnSync } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

const temporary = await mkdtemp(join(tmpdir(), 'threadbox-npm-package-'))
const installation = join(temporary, 'installation')
const codexHome = join(temporary, 'codex-home')
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('npm_execpath is required for the package smoke test.')
const fakeCli = resolve(
  'tests', 'fixtures', 'bin', process.platform === 'win32' ? 'codex.cmd' : 'codex'
)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
  }
  return result
}

try {
  const packed = run(process.execPath, [npmCli,
    'pack', '--workspace=codex-threadbox', '--pack-destination', temporary, '--json'
  ])
  const packageName = JSON.parse(packed.stdout)[0]?.filename
  if (!packageName) throw new Error('npm pack did not report a package filename.')
  run(process.execPath, [
    npmCli, 'install', '--prefix', installation, '--ignore-scripts', join(temporary, packageName)
  ])

  const binDirectory = join(installation, 'node_modules', '.bin')
  const wrapper = join(binDirectory, process.platform === 'win32' ? 'threadbox.cmd' : 'threadbox')
  await access(wrapper)
  const executable = join(
    installation, 'node_modules', 'codex-threadbox', 'dist', 'threadbox.cjs'
  )
  const version = run(process.execPath, [executable, '--version'])
  const packageMetadata = JSON.parse(await readFile(resolve('packages/cli/package.json'), 'utf8'))
  if (version.stdout.trim() !== packageMetadata.version) {
    throw new Error('Installed package returned the wrong version.')
  }

  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  const listed = run(process.execPath, [executable,
    '--codex-binary', fakeCli, '--codex-home', codexHome, '--json', 'list'
  ], {
    env: {
      ...process.env,
      [pathKey]: [binDirectory, process.env[pathKey] ?? ''].join(delimiter),
      THREADBOX_TEST_DISABLE_PROCESS_SCAN: '1'
    }
  })
  const output = JSON.parse(listed.stdout)
  if (output.schemaVersion !== 1 || output.records.length !== 3 ||
      output.records.some((record) => record.internal)) {
    throw new Error('Installed npm package did not list fake tasks.')
  }
  process.stdout.write('Packed npm CLI installation smoke test passed.\n')
} finally {
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
