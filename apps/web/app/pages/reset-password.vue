<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const token = computed(() => typeof route.query.token === 'string' ? route.query.token : '')
const submitting = ref(false)
const schema = z.object({
  password: z.string().min(8, '新密码至少 8 个字符'),
  confirm_password: z.string().min(8, '请再次输入新密码'),
}).refine(value => value.password === value.confirm_password, {
  message: '两次输入的新密码不一致',
  path: ['confirm_password'],
})
type Form = z.output<typeof schema>
const state = reactive<Partial<Form>>({ password: '', confirm_password: '' })

async function submit(event: FormSubmitEvent<Form>) {
  if (!token.value) return
  submitting.value = true
  try {
    await $controlApi('post', '/api/auth/password/reset/confirm', {
      body: { token: token.value, new_password: event.data.password },
    })
    toast.add({ title: '密码已重置', description: '请使用新密码登录。', color: 'success' })
    await router.push('/login')
  }
  catch (error) {
    toast.add({ title: '密码重置失败', description: controlPlaneErrorMessage(error), color: 'error' })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-xl py-8">
    <UPageCard title="重置密码" description="一次性凭证使用后会立即失效。" icon="i-lucide-key-round">
      <div v-if="!token" class="rounded-lg border border-error/30 bg-error/5 p-4 text-sm">重置链接缺少有效凭证。</div>
      <UForm v-else :schema="schema" :state="state" class="space-y-4" @submit="submit">
        <UFormField name="password" label="新密码" required><UInput v-model="state.password" type="password" class="w-full" /></UFormField>
        <UFormField name="confirm_password" label="确认新密码" required><UInput v-model="state.confirm_password" type="password" class="w-full" /></UFormField>
        <UButton type="submit" block :loading="submitting">重置密码</UButton>
      </UForm>
    </UPageCard>
  </div>
</template>
