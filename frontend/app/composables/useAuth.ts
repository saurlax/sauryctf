import type { components } from '~/types/api'

type UserInfo = components['schemas']['UserInfo']

interface AuthState {
  user: UserInfo | null
}

const authState = reactive<AuthState>({
  user: null,
})

export function useAuth() {
  const router = useRouter()

  const isLoggedIn = computed(() => !!authState.user)

  function clearAuth() {
    authState.user = null
  }

  async function fetchUser() {
    try {
      const res = await $api('get', '/api/auth/me')
      authState.user = res.user
      return res.user
    }
    catch {
      clearAuth()
      return null
    }
  }

  async function login(username: string, password: string) {
    const res = await $api('post', '/api/auth/login', {
      body: { username, password },
    })
    authState.user = res.user
  }

  async function register(username: string, email: string, password: string) {
    const res = await $api('post', '/api/auth/register', {
      body: { username, email, password },
    })
    authState.user = res.user
  }

  async function logout() {
    try {
      await $api('post', '/api/auth/logout')
    }
    catch {}
    clearAuth()
    router.push('/login')
  }

  return {
    authState,
    isLoggedIn,
    clearAuth,
    fetchUser,
    login,
    register,
    logout,
  }
}
