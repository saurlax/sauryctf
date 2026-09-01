<script setup lang="ts">
const route = useRoute()
const { fetchUser } = useAuth()
const state = ref<'working' | 'success' | 'error'>('working')
const message = ref('正在验证邮箱…')

onMounted(async () => {
  const token = typeof route.query.token === 'string' ? route.query.token : ''
  if (!token) {
    state.value = 'error'
    message.value = '验证链接缺少有效凭证。'
    return
  }
  try {
    await $controlApi('post', '/api/auth/email/verification/confirm', { body: { token } })
    await fetchUser({ force: true })
    state.value = 'success'
    message.value = '邮箱验证完成。'
  }
  catch (error) {
    state.value = 'error'
    message.value = controlPlaneErrorMessage(error)
  }
})
</script>

<template>
  <div class="mx-auto max-w-xl py-8">
    <UPageCard title="邮箱验证" :description="message" icon="i-lucide-badge-check">
      <div class="flex items-center gap-3">
        <UIcon v-if="state === 'working'" name="i-lucide-loader-2" class="size-5 animate-spin" />
        <UBadge v-else :color="state === 'success' ? 'success' : 'error'" variant="soft">{{ state === 'success' ? '验证成功' : '验证失败' }}</UBadge>
      </div>
      <template #footer>
        <UButton :to="state === 'success' ? '/console/account' : '/login'" variant="outline">继续</UButton>
      </template>
    </UPageCard>
  </div>
</template>
