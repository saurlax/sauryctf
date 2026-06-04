export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const { authState, fetchUser } = useAuth()

  if (!authState.user) {
    await fetchUser()
  }

  if (!authState.user) {
    const redirect = encodeURIComponent(to.fullPath)
    return navigateTo(`/login?redirect=${redirect}`)
  }

  if (!['admin', 'super_admin'].includes(authState.user.role)) {
    return navigateTo('/console')
  }
})
