import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const violations = []
const coverage = new Map()
const textExtensions = new Set([
  '', '.cjs', '.go', '.json', '.js', '.mjs', '.sql', '.ts', '.tsx', '.vue', '.yaml', '.yml',
])

function walk(target) {
  if (!existsSync(target)) return []
  if (!statSync(target).isDirectory()) return [target]
  return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return []
    return walk(resolve(target, entry.name))
  })
}

function inspectContent(label, paths, pattern, excluded = () => false) {
  let inspected = 0
  for (const target of paths.flatMap((path) => walk(resolve(root, path)))) {
    if (!textExtensions.has(extname(target))) continue
    const normalized = relative(root, target).split(sep).join('/')
    if (excluded(normalized)) continue
    inspected += 1
    const content = readFileSync(target, 'utf8')
    const lines = content.split(/\r?\n/u)
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        violations.push(`${label}: ${relative(root, target)}:${index + 1}: ${line.trim()}`)
      }
      pattern.lastIndex = 0
    })
  }
  coverage.set(label, inspected)
}

function inspectPathNames(label, paths, pattern) {
  let inspected = 0
  for (const target of paths.flatMap((path) => walk(resolve(root, path)))) {
    inspected += 1
    const normalized = relative(root, target).split(sep).join('/')
    if (pattern.test(normalized)) violations.push(`${label}: forbidden path ${normalized}`)
    pattern.lastIndex = 0
  }
  coverage.set(label, inspected)
}

const forbiddenDomain = /(?:^|[^a-z0-9])(?:awd|vpn|checkers?|worker[_-]jobs)(?:[^a-z0-9]|$)|terminal[_-](?:session|gateway)|(?:code[_-])?execution[_-]jobs?/giu
const forbiddenRoute = /(?:^|[/_.-])(?:awd|vpn|checkers?|worker[_-]jobs)(?:[/_.-]|$)|terminal[_-](?:session|gateway)/giu
const excludeNonProduction = path => /(?:^|\/)(?:[^/]+\.(?:test|spec)\.[^/]+|[^/]+_test\.go)$/u.test(path)
  || path.includes('/test-support/')
const intentionalRejectionSource = path => path === 'apps/web/server/domains/contests/admission.ts'

inspectContent('OpenAPI', ['api/openapi.yaml'], forbiddenDomain)
inspectContent('database schema', [
  'apps/web/db/migrations',
  'apps/web/server/infrastructure/db/schema.ts',
], forbiddenDomain)
inspectContent('control-plane production surface', [
  'apps/web/server',
  'apps/web/shared/contracts',
], forbiddenDomain, path => excludeNonProduction(path) || intentionalRejectionSource(path))
inspectContent('Worker protocol', ['apps/worker'], forbiddenDomain, excludeNonProduction)
inspectContent('deployment manifest', [
  'compose.dev.yml',
  'deploy',
  'deployments',
  'k8s',
  'helm',
  'charts',
  'manifests',
  '.github/workflows',
], forbiddenDomain)
inspectContent('web AWD surface', ['apps/web/app'], forbiddenDomain)
inspectPathNames('frontend and API routes', ['apps/web/app/pages', 'apps/web/server/api'], forbiddenRoute)
inspectPathNames('deployment paths', [
  'deploy',
  'deployments',
  'k8s',
  'helm',
  'charts',
  'manifests',
], forbiddenRoute)

if (violations.length > 0) {
  console.error('Jeopardy first-release scope check failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log(`Jeopardy first-release scope check passed. ${JSON.stringify(Object.fromEntries(coverage))}`)
}
