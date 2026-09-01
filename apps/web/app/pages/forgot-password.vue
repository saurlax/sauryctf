<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

definePageMeta({ middleware: 'guest' })

const { errorMessage, t } = usePlatformUi()
const schema = computed(() => z.object({ email: z.string().email(t('validation.email')) }))
interface Form { email: string }
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
    toast.add({ title: t('auth.request_failed'), description: errorMessage(error), color: 'error' })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-xl py-8">
    <UPageCard :title="t('auth.forgot.title')" :description="t('auth.forgot.description')" icon="i-lucide-key-round">
      <div v-if="accepted" class="rounded-lg border border-success/30 bg-success/5 p-4 text-sm">
        {{ t('auth.forgot.accepted') }}
      </div>
      <UForm v-else :schema="schema" :state="state" class="space-y-4" @submit="submit">
        <UFormField name="email" :label="t('auth.email')" required><UInput v-model="state.email" type="email" class="w-full" /></UFormField>
        <TurnstileField
          v-if="config.public.turnstileSiteKey"
          v-model="turnstileToken"
          :site-key="config.public.turnstileSiteKey"
          action="password_reset"
        />
        <UButton type="submit" block :loading="submitting">{{ t('auth.forgot.submit') }}</UButton>
      </UForm>
      <template #footer><UButton to="/login" variant="ghost" icon="i-lucide-arrow-left">{{ t('auth.register.back_login') }}</UButton></template>
    </UPageCard>
  </div>
</template>
