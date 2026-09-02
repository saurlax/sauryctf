import type {
  ChangeEmailRequest,
  ChangePasswordRequest,
  IdentitySessionResponse,
  IdentityUser,
  LoginIdentityRequest,
  RegisterIdentityRequest,
} from '~~/shared/contracts/identity'

interface AuthState {
  user: IdentityUser | null
  initialized: boolean
}

const authState = reactive<AuthState>({
  user: null,
  initialized: false,
})

let fetchUserPromise: Promise<IdentityUser | null> | null = null

export function useAuth() {
  const router = useRouter()

  const isLoggedIn = computed(() => !!authState.user)

  function clearAuth() {
    authState.user = null
  }

  async function fetchUser(options?: { force?: boolean }) {
    if (!options?.force && authState.initialized) {
      return authState.user
    }

    if (fetchUserPromise) {
      return fetchUserPromise
    }

    fetchUserPromise = (async () => {
      try {
        const res = await $controlApi<IdentitySessionResponse>('get', '/api/auth/me')
        authState.user = res.user
        return res.user
      }
      catch {
        clearAuth()
        return null
      }
      finally {
        authState.initialized = true
        fetchUserPromise = null
      }
    })()

    return fetchUserPromise
  }

  async function ensureInitialized() {
    if (authState.initialized) {
      return authState.user
    }

    return fetchUser()
  }

  async function login(identifier: string, password: string, turnstileToken?: string) {
    const res = await $controlApi<IdentitySessionResponse, LoginIdentityRequest>('post', '/api/auth/login', {
      body: { identifier, password, turnstile_token: turnstileToken },
    })
    authState.user = res.user
    authState.initialized = true
  }

  async function register(username: string, email: string, password: string, turnstileToken?: string) {
    const res = await $controlApi<IdentitySessionResponse, RegisterIdentityRequest>('post', '/api/auth/register', {
      body: { username, email, password, turnstile_token: turnstileToken },
    })
    authState.user = res.user
    authState.initialized = true
  }

  async function logout() {
    try {
      await $controlApi('post', '/api/auth/logout')
    }
    catch {}
    clearAuth()
    authState.initialized = true
    router.push('/login')
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    await $controlApi<unknown, ChangePasswordRequest>('post', '/api/auth/password/change', {
      body: { current_password: currentPassword, new_password: newPassword },
    })
    return fetchUser({ force: true })
  }

  async function changeEmail(email: string) {
    await $controlApi<unknown, ChangeEmailRequest>('post', '/api/auth/email/change', { body: { email } })
    return fetchUser({ force: true })
  }

  async function requestEmailVerification() {
    return $controlApi('post', '/api/auth/email/verification/request')
  }

  async function redirectToLogin() {
    clearAuth()
    authState.initialized = true
    await router.push('/login')
  }

  return {
    authState,
    isLoggedIn,
    clearAuth,
    fetchUser,
    ensureInitialized,
    login,
    register,
    changePassword,
    changeEmail,
    requestEmailVerification,
    logout,
    redirectToLogin,
  }
}
