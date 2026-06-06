export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const { authState, ensureInitialized } = useAuth()

  await ensureInitialized()

  if (!authState.user) {
    return
  }

  const redirect = resolveOptionalAuthRedirect(to.query.redirect)
  if (redirect) {
    return navigateTo(redirect)
  }

  return navigateTo('/console')
})
