export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const { authState, ensureInitialized } = useAuth()
  const protectedPaths = ['/console']

  if (!protectedPaths.some(p => to.path.startsWith(p))) {
    return
  }

  await ensureInitialized()

  if (!authState.user) {
    const redirect = encodeURIComponent(to.fullPath)
    return navigateTo(`/login?redirect=${redirect}`)
  }
})
