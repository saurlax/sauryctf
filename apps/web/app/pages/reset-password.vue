<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { errorMessage, t } = usePlatformUi()
const token = computed(() => typeof route.query.token === 'string' ? route.query.token : '')
const submitting = ref(false)
const schema = computed(() => z.object({
  password: z.string().min(8, t('validation.password_min_8')),
  confirm_password: z.string().min(8, t('validation.confirm_password_min_8')),
}).refine(value => value.password === value.confirm_password, {
  message: t('validation.new_password_mismatch'),
  path: ['confirm_password'],
}))
interface Form { password: string, confirm_password: string }
const state = reactive<Partial<Form>>({ password: '', confirm_password: '' })

async function submit(event: FormSubmitEvent<Form>) {
  if (!token.value) return
  submitting.value = true
  try {
    await $controlApi('post', '/api/auth/password/reset/confirm', {
      body: { token: token.value, new_password: event.data.password },
    })
    toast.add({ title: t('auth.reset.success'), description: t('auth.reset.success_description'), color: 'success' })
    await router.push('/login')
  }
  catch (error) {
    toast.add({ title: t('auth.reset.failed'), description: errorMessage(error), color: 'error' })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-xl py-8">
    <UPageCard :title="t('auth.reset.title')" :description="t('auth.reset.description')" icon="i-lucide-key-round">
      <div v-if="!token" class="rounded-lg border border-error/30 bg-error/5 p-4 text-sm">{{ t('auth.reset.missing_token') }}</div>
      <UForm v-else :schema="schema" :state="state" class="space-y-4" @submit="submit">
        <UFormField name="password" :label="t('auth.reset.new_password')" required><UInput v-model="state.password" type="password" class="w-full" /></UFormField>
        <UFormField name="confirm_password" :label="t('auth.reset.confirm_password')" required><UInput v-model="state.confirm_password" type="password" class="w-full" /></UFormField>
        <UButton type="submit" block :loading="submitting">{{ t('auth.reset.submit') }}</UButton>
      </UForm>
    </UPageCard>
  </div>
</template>
