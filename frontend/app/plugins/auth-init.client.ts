export default defineNuxtPlugin(() => {
  const { fetchUser } = useAuth()

  void fetchUser()
})
