export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const { authState, fetchUser } = useAuth()

  if (!authState.user) {
    await fetchUser()
  }

  if (!authState.user) {
    return
  }

  const redirect = to.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/')) {
    return navigateTo(redirect)
  }

  return navigateTo('/console')
})
