import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const expected = {
  node: '24.20.0',
  pnpm: '10.34.5',
  go: '1.26.3',
}
const failures = []

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

function expectEqual(label, actual, wanted) {
  if (actual !== wanted) failures.push(`${label}: expected ${wanted}, received ${actual}`)
}

function expectGoVersion(label, content) {
  const escaped = expected.go.replaceAll('.', '\\.')
  if (!new RegExp(`^go ${escaped}$`, 'mu').test(content)) {
    failures.push(`${label}: missing exact go ${expected.go} directive`)
  }
}

const rootPackage = JSON.parse(read('package.json'))
const webPackage = JSON.parse(read('apps/web/package.json'))
const workflow = read('.github/workflows/ci.yml')
const goWork = read('go.work')
const workerGoMod = read('apps/worker/go.mod')

expectEqual('.node-version', read('.node-version').trim(), expected.node)
expectEqual('.nvmrc', read('.nvmrc').trim(), expected.node)
expectEqual('root Node engine', rootPackage.engines?.node, expected.node)
expectEqual('web Node engine', webPackage.engines?.node, expected.node)
expectEqual('root packageManager', rootPackage.packageManager, `pnpm@${expected.pnpm}`)
expectEqual('root pnpm engine', rootPackage.engines?.pnpm, expected.pnpm)
expectEqual('web pnpm engine', webPackage.engines?.pnpm, expected.pnpm)
expectEqual('.go-version', read('.go-version').trim(), expected.go)

expectGoVersion('go.work', goWork)
expectGoVersion('apps/worker/go.mod', workerGoMod)

if (!/^use \.\/apps\/worker$/mu.test(goWork)) {
  failures.push('go.work: apps/worker must be the active workspace module')
}
if (/legacy\/go-monolith/mu.test(goWork)) {
  failures.push('go.work: legacy/go-monolith must not be an active workspace module')
}

for (const lockfile of ['pnpm-lock.yaml', 'apps/worker/go.sum']) {
  if (!existsSync(resolve(root, lockfile))) failures.push(`${lockfile}: required lock file is missing`)
}

const requiredCiFragments = [
  'node-version-file: .node-version',
  `version: ${expected.pnpm}`,
  'go-version-file: .go-version',
  'pnpm install --frozen-lockfile',
  'pnpm check',
  'pnpm test',
  'pnpm build',
]

for (const fragment of requiredCiFragments) {
  if (!workflow.includes(fragment)) failures.push(`CI workflow: missing ${fragment}`)
}

if (failures.length > 0) {
  console.error('Toolchain check failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exitCode = 1
} else {
  console.log(`Toolchain check passed (Node ${expected.node}, pnpm ${expected.pnpm}, Go ${expected.go}).`)
}
