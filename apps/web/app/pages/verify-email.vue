<script setup lang="ts">
const route = useRoute()
const { fetchUser } = useAuth()
const { errorMessage, t } = usePlatformUi()
const state = ref<'working' | 'success' | 'error'>('working')
const message = ref(t('auth.verify.working'))

onMounted(async () => {
  const token = typeof route.query.token === 'string' ? route.query.token : ''
  if (!token) {
    state.value = 'error'
    message.value = t('auth.verify.missing_token')
    return
  }
  try {
    await $controlApi('post', '/api/auth/email/verification/confirm', { body: { token } })
    await fetchUser({ force: true })
    state.value = 'success'
    message.value = t('auth.verify.complete')
  }
  catch (error) {
    state.value = 'error'
    message.value = errorMessage(error)
  }
})
</script>

<template>
  <div class="mx-auto max-w-xl py-8">
    <UPageCard :title="t('auth.verify.title')" :description="message" icon="i-lucide-badge-check">
      <div class="flex items-center gap-3">
        <UIcon v-if="state === 'working'" name="i-lucide-loader-2" class="size-5 animate-spin" />
        <UBadge v-else :color="state === 'success' ? 'success' : 'error'" variant="soft">{{ state === 'success' ? t('auth.verify.success') : t('auth.verify.failed') }}</UBadge>
      </div>
      <template #footer>
        <UButton :to="state === 'success' ? '/console/account' : '/login'" variant="outline">{{ t('auth.continue') }}</UButton>
      </template>
    </UPageCard>
  </div>
</template>
