export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

  const apiFetch = $fetch.create({
    baseURL: import.meta.server ? config.apiBase : config.public.apiBase,
    credentials: 'include',
    headers: requestHeaders,
  })

  return {
    provide: { apiFetch },
  }
})
