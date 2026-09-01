export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const { authState, ensureInitialized } = useAuth()

  await ensureInitialized()

  if (!authState.user) {
    return navigateTo(buildAuthEntryPath('/login', to.fullPath))
  }

  if (!['admin', 'super_admin'].includes(authState.user.role)) {
    return navigateTo('/console')
  }
})
