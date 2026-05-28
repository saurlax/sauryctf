export default defineNuxtPlugin(() => {
  const apiFetch = $fetch.create({
    credentials: 'include',
  })

  return {
    provide: { apiFetch },
  }
})
