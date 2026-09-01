export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const { authState, ensureInitialized } = useAuth()
  const protectedPaths = ['/console']

  if (!protectedPaths.some(p => to.path.startsWith(p))) {
    return
  }

  await ensureInitialized()

  if (!authState.user) {
    return navigateTo(buildAuthEntryPath('/login', to.fullPath))
  }

  if ((authState.user.must_change_password || !authState.user.email_verified) && to.path !== '/console/account') {
    return navigateTo('/console/account')
  }
})
