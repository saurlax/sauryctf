const frontendBaseUrl = process.env.FRONTEND_BASE_URL ?? 'http://127.0.0.1:3000'

function assertContains(content, expected, message) {
  if (!content.includes(expected)) throw new Error(`${message}\nExpected to find: ${expected}`)
}

function assertNotContains(content, unexpected, message) {
  if (content.includes(unexpected)) throw new Error(`${message}\nUnexpected content: ${unexpected}`)
}

async function html(path) {
  const response = await fetch(new URL(path, frontendBaseUrl))
  if (!response.ok) throw new Error(`GET ${path} returned ${response.status}`)
  return response.text()
}

const redirectTarget = '/games/42?tab=challenges'
const encodedRedirect = encodeURIComponent(redirectTarget)
const loginPage = await html(`/login?redirect=${encodedRedirect}`)
assertContains(loginPage, `/register?redirect=${encodedRedirect}`, 'Login did not preserve the redirect in its register link.')

const registerPage = await html(`/register?redirect=${encodedRedirect}`)
assertContains(registerPage, `/login?redirect=${encodedRedirect}`, 'Register did not preserve the redirect in its login link.')

const unsafeLoginPage = await html('/login?redirect=%2F%2Fevil.example')
assertContains(unsafeLoginPage, '/register?redirect=%2Fconsole', 'Login did not use its safe fallback.')
assertNotContains(unsafeLoginPage, '//evil.example', 'Login exposed an unsafe redirect.')

const unsafeRegisterPage = await html('/register?redirect=%2F%2Fevil.example')
assertContains(unsafeRegisterPage, '/login?redirect=%2Fconsole%2Fteam', 'Register did not use its safe fallback.')
assertNotContains(unsafeRegisterPage, '//evil.example', 'Register exposed an unsafe redirect.')

console.log(`Auth redirect check passed against ${frontendBaseUrl}`)
