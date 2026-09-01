import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const violations = []

function sourceFiles(path, extensions) {
  const target = resolve(root, path)
  if (!existsSync(target)) return []
  if (!statSync(target).isDirectory()) return extensions.has(extname(target)) ? [target] : []

  return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return []
    return sourceFiles(relative(root, resolve(target, entry.name)), extensions)
  })
}

function inspect(label, paths, patterns, extensions = new Set(['.ts', '.tsx', '.vue'])) {
  for (const file of paths.flatMap((path) => sourceFiles(path, extensions))) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/u)
    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        if (pattern.test(line)) {
          violations.push(`${label}: ${relative(root, file)}:${index + 1}: ${line.trim()}`)
        }
        pattern.lastIndex = 0
      }
    })
  }
}

const databaseImports = [
  /from\s+['"](?:drizzle-orm|pg|postgres)(?:[/'"]|$)/gu,
  /(?:from\s+|import\s*\()['"](?:#server|~~\/server|~\/server|\.\.\/)+(?:infrastructure\/)?db(?:[/'"]|$)/gu,
  /(?:from\s+|import\s*\()['"][^'"]*server\/infrastructure\/db(?:[/'"]|$)/gu,
]

const directTableAccess = [
  /\b(?:db|tx)\.(?:select|insert|update|delete|execute|transaction)\s*\(/gu,
  /\bsql\s*`/gu,
]

inspect('page database access', ['apps/web/app/pages'], [...databaseImports, ...directTableAccess])
inspect('API handler database access', ['apps/web/server/api'], [...databaseImports, ...directTableAccess])
inspect('domain reverse dependency', ['apps/web/server/domains'], [
  /(?:from\s+|import\s*\()['"][^'"]*(?:server\/api|app\/pages)(?:[/'"]|$)/gu,
])
inspect('infrastructure reverse dependency', ['apps/web/server/infrastructure'], [
  /(?:from\s+|import\s*\()['"][^'"]*(?:server\/api|app\/pages)(?:[/'"]|$)/gu,
])
inspect('shared contract server dependency', ['apps/web/shared/contracts'], [
  /(?:from\s+|import\s*\()['"][^'"]*(?:server|app\/pages)(?:[/'"]|$)/gu,
])

for (const staleRoot of ['frontend', 'cmd', 'internal', 'worker', 'server']) {
  if (existsSync(resolve(root, staleRoot))) {
    violations.push(`active source outside apps/: unexpected root path ${staleRoot}`)
  }
}

const goWork = readFileSync(resolve(root, 'go.work'), 'utf8')
if (!/^use \.\/apps\/worker$/mu.test(goWork) || /legacy\/go-monolith/mu.test(goWork)) {
  violations.push('Go workspace must contain apps/worker and must exclude legacy/go-monolith')
}

const pnpmWorkspace = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')
if (!/^\s*- apps\/\*$/mu.test(pnpmWorkspace) || /frontend|legacy/mu.test(pnpmWorkspace)) {
  violations.push('pnpm workspace must discover active packages only through apps/*')
}

const workerGoMod = readFileSync(resolve(root, 'apps/worker/go.mod'), 'utf8')
if (!/^module github\.com\/saurlax\/sauryctf\/apps\/worker$/mu.test(workerGoMod)) {
  violations.push('apps/worker must use its independent module path')
}
if (/gin-gonic|legacy\/go-monolith/mu.test(workerGoMod)) {
  violations.push('apps/worker must not depend on the legacy public monolith')
}

inspect('Worker legacy/business import', ['apps/worker'], [
  /github\.com\/saurlax\/sauryctf\/(?:cmd|internal|legacy)(?:\/|['"])/gu,
  /legacy\/go-monolith/gu,
], new Set(['.go']))

inspect('Worker public business route', ['apps/worker'], [
  /['"]\/api\/(?:auth|users|teams|contests|games|challenges|submissions|scoreboards|admin)(?:\/|['"])/gu,
], new Set(['.go']))

for (const file of sourceFiles('apps/worker', new Set(['.go']))) {
  const normalized = relative(root, file).split(sep).join('/')
  if (/(?:^|\/)(?:auth|users|teams|contests|games|challenges|submissions|scoring|scoreboards|rbac)(?:\/|\.|$)/u.test(normalized)) {
    violations.push(`Worker business package: forbidden path ${normalized}`)
  }
}

if (violations.length > 0) {
  console.error('Control-plane boundary check failed:')
  violations.forEach((violation) => console.error(`- ${violation}`))
  process.exitCode = 1
} else {
  console.log('Control-plane and monorepo boundary checks passed.')
}
