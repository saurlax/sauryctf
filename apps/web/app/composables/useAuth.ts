import type { components } from '~/types/api'

type UserInfo = components['schemas']['UserInfo']

interface AuthState {
  user: UserInfo | null
  initialized: boolean
}

const authState = reactive<AuthState>({
  user: null,
  initialized: false,
})

let fetchUserPromise: Promise<UserInfo | null> | null = null

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
        const res = await $api('get', '/api/auth/me')
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

  async function login(username: string, password: string) {
    const res = await $api('post', '/api/auth/login', {
      body: { username, password },
    })
    authState.user = res.user
    authState.initialized = true
  }

  async function register(username: string, email: string, password: string) {
    const res = await $api('post', '/api/auth/register', {
      body: { username, email, password },
    })
    authState.user = res.user
    authState.initialized = true
  }

  async function logout() {
    try {
      await $api('post', '/api/auth/logout')
    }
    catch {}
    clearAuth()
    authState.initialized = true
    router.push('/login')
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
    logout,
    redirectToLogin,
  }
}
