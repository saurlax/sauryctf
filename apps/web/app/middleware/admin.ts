export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const { authState, ensureInitialized } = useAuth()

  await ensureInitialized()

  if (!authState.user) {
    return navigateTo(buildAuthEntryPath('/login', to.fullPath))
  }

  if (authState.user.must_change_password || !authState.user.email_verified) {
    return navigateTo('/console/account')
  }

  if (authState.user.role !== 'admin') {
    return navigateTo('/console')
  }
})
