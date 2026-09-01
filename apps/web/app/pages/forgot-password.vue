<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

definePageMeta({ middleware: 'guest' })

const schema = z.object({ email: z.string().email('请输入有效邮箱') })
type Form = z.output<typeof schema>
const state = reactive<Partial<Form>>({ email: '' })
const submitting = ref(false)
const accepted = ref(false)
const toast = useToast()
const config = useRuntimeConfig()
const turnstileToken = ref('')

async function submit(event: FormSubmitEvent<Form>) {
  submitting.value = true
  try {
    await $controlApi('post', '/api/auth/password/reset/request', {
      body: { email: event.data.email, turnstile_token: turnstileToken.value || undefined },
    })
    accepted.value = true
  }
  catch (error) {
    toast.add({ title: '请求失败', description: controlPlaneErrorMessage(error), color: 'error' })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-xl py-8">
    <UPageCard title="找回密码" description="提交账号邮箱后，平台会在可用时发送一次性重置链接。" icon="i-lucide-key-round">
      <div v-if="accepted" class="rounded-lg border border-success/30 bg-success/5 p-4 text-sm">
        请求已接受。如果该邮箱对应有效账号，重置邮件会进入发送队列。
      </div>
      <UForm v-else :schema="schema" :state="state" class="space-y-4" @submit="submit">
        <UFormField name="email" label="邮箱" required><UInput v-model="state.email" type="email" class="w-full" /></UFormField>
        <TurnstileField
          v-if="config.public.turnstileSiteKey"
          v-model="turnstileToken"
          :site-key="config.public.turnstileSiteKey"
          action="password_reset"
        />
        <UButton type="submit" block :loading="submitting">发送重置邮件</UButton>
      </UForm>
      <template #footer><UButton to="/login" variant="ghost" icon="i-lucide-arrow-left">返回登录</UButton></template>
    </UPageCard>
  </div>
</template>
