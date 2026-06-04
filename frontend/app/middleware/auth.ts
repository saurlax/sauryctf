export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const { authState, fetchUser } = useAuth()
  const protectedPaths = ['/console']

  if (!protectedPaths.some(p => to.path.startsWith(p))) {
    return
  }

  if (!authState.user) {
    await fetchUser()
  }

  if (!authState.user) {
    return navigateTo('/login')
  }
})
