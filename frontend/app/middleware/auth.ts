export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.server) return

  const token = localStorage.getItem('token')
  const protectedPaths = ['/console']

  if (protectedPaths.some(p => to.path.startsWith(p)) && !token) {
    return navigateTo('/login')
  }
})
