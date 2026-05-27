interface AuthState {
  token: string | null
  user: {
    id: number
    username: string
    email: string
    role: string
  } | null
}

const authState = reactive<AuthState>({
  token: null,
  user: null,
})

export function useAuth() {
  const router = useRouter()

  const isLoggedIn = computed(() => !!authState.token)

  function setToken(token: string) {
    authState.token = token
    if (import.meta.client) {
      localStorage.setItem('token', token)
    }
  }

  function loadToken() {
    if (import.meta.client) {
      authState.token = localStorage.getItem('token')
    }
  }

  function clearAuth() {
    authState.token = null
    authState.user = null
    if (import.meta.client) {
      localStorage.removeItem('token')
    }
  }

  async function fetchUser() {
    if (!authState.token) return null
    try {
      const res = await $fetch<{ id: number, username: string, email: string, role: string }>('/api/auth/me', {
        headers: { Authorization: `Bearer ${authState.token}` },
      })
      authState.user = res
      return res
    }
    catch {
      clearAuth()
      return null
    }
  }

  async function login(username: string, password: string) {
    const res = await $fetch<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    })
    setToken(res.token)
    await fetchUser()
  }

  async function register(username: string, email: string, password: string) {
    const res = await $fetch<{ token: string }>('/api/auth/register', {
      method: 'POST',
      body: { username, email, password },
    })
    setToken(res.token)
    await fetchUser()
  }

  async function logout() {
    try {
      await $fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authState.token}` },
      })
    }
    catch {}
    clearAuth()
    router.push('/login')
  }

  // Initialize on client
  if (import.meta.client && !authState.token) {
    loadToken()
  }

  return {
    authState,
    isLoggedIn,
    setToken,
    loadToken,
    clearAuth,
    fetchUser,
    login,
    register,
    logout,
  }
}
