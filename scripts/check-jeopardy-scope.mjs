import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const violations = []
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

function inspectContent(label, paths, pattern) {
  for (const target of paths.flatMap((path) => walk(resolve(root, path)))) {
    if (!textExtensions.has(extname(target))) continue
    const content = readFileSync(target, 'utf8')
    const lines = content.split(/\r?\n/u)
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        violations.push(`${label}: ${relative(root, target)}:${index + 1}: ${line.trim()}`)
      }
      pattern.lastIndex = 0
    })
  }
}

function inspectPathNames(label, paths, pattern) {
  for (const target of paths.flatMap((path) => walk(resolve(root, path)))) {
    const normalized = relative(root, target).split(sep).join('/')
    if (pattern.test(normalized)) violations.push(`${label}: forbidden path ${normalized}`)
    pattern.lastIndex = 0
  }
}

const forbiddenDomain = /\b(?:awd|vpn|checker)\b|terminal[_-](?:session|gateway)|(?:code[_-])?execution[_-]job/giu
const forbiddenRoute = /(?:^|[/_.-])(?:awd|vpn|checker)(?:[/_.-]|$)|terminal[_-](?:session|gateway)/giu

inspectContent('OpenAPI', ['api/openapi.yaml'], forbiddenDomain)
inspectContent('database migration', ['apps/web/db/migrations'], forbiddenDomain)
inspectContent('Worker protocol/deployment', ['apps/worker', 'deploy', 'deployments', 'k8s'], forbiddenDomain)
inspectContent('web AWD surface', ['apps/web/app'], /\bawd\b/giu)
inspectPathNames('web route', ['apps/web/app/pages', 'apps/web/server/api'], forbiddenRoute)

if (violations.length > 0) {
  console.error('Jeopardy first-release scope check failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log('Jeopardy first-release scope check passed.')
}
