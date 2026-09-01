<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({
  middleware: 'guest',
})

const { register, requestEmailVerification } = useAuth()
const router = useRouter()
const route = useRoute()
const toast = useToast()
const config = useRuntimeConfig()
const { errorMessage, platformSettings, t } = usePlatformUi()
const submitting = ref(false)

const redirectTarget = computed(() => {
  return resolveAuthRedirect(route.query.redirect, '/console/team')
})

const registerSchema = computed(() => z.object({
  username: z.string().min(3, t('validation.username_min')),
  email: z.string().email(t('validation.email')),
  password: z.string().min(6, t('validation.password_min_6')),
  confirm_password: z.string().min(6, t('validation.confirm_password_min_6')),
  turnstile_token: z.string().optional(),
}).refine(value => value.password === value.confirm_password, {
  message: t('validation.password_mismatch'),
  path: ['confirm_password'],
}))

interface RegisterSchema {
  username: string
  email: string
  password: string
  confirm_password: string
  turnstile_token?: string
}

const state = reactive<Partial<RegisterSchema>>({
  username: '',
  email: '',
  password: '',
  confirm_password: '',
  turnstile_token: '',
})

async function onRegister(payload: FormSubmitEvent<RegisterSchema>) {
  submitting.value = true
  try {
    await register(payload.data.username, payload.data.email, payload.data.password, payload.data.turnstile_token)
    try {
      await requestEmailVerification()
      toast.add({ title: t('auth.register.success'), description: t('auth.register.verification_queued'), color: 'success' })
    }
    catch {
      toast.add({ title: t('auth.register.success'), description: t('auth.register.verification_retry'), color: 'warning' })
    }
    await router.push(resolveRedirect())
  }
  catch (e: any) {
    toast.add({ title: t('auth.register.failed'), description: errorMessage(e), color: 'error' })
  }
  finally {
    submitting.value = false
  }
}

function resolveRedirect() {
  if (isSafeAuthRedirect(route.query.redirect)) {
    return {
      path: '/console/team',
      query: {
        redirect: route.query.redirect,
      },
    }
  }
  return {
    path: '/console/team',
  }
}

const loginTo = computed(() => {
  return buildAuthEntryPath('/login', redirectTarget.value)
})
</script>

<template>
  <div class="mx-auto max-w-xl py-8">
    <UPageCard
      :title="t('auth.register.title')"
      :description="t('auth.register.description')"
      icon="i-lucide-user-plus"
    >
      <div v-if="!platformSettings.public_registration_enabled" class="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm">
        {{ t('auth.registration_closed') }}
      </div>
      <UForm v-else :schema="registerSchema" :state="state" class="space-y-4" @submit="onRegister">
        <UFormField name="username" :label="t('auth.username')" required>
          <UInput v-model="state.username" class="w-full" :placeholder="t('auth.username_placeholder')" :disabled="submitting" />
        </UFormField>

        <UFormField name="email" :label="t('auth.email')" required>
          <UInput v-model="state.email" class="w-full" type="email" :placeholder="t('auth.email_placeholder')" :disabled="submitting" />
        </UFormField>

        <UFormField name="password" :label="t('auth.password')" required>
          <UInput v-model="state.password" class="w-full" type="password" :placeholder="t('auth.password_placeholder')" :disabled="submitting" />
        </UFormField>

        <UFormField name="confirm_password" :label="t('auth.confirm_password')" required>
          <UInput v-model="state.confirm_password" class="w-full" type="password" :placeholder="t('auth.confirm_password_placeholder')" :disabled="submitting" />
        </UFormField>

        <TurnstileField
          v-if="config.public.turnstileSiteKey"
          v-model="state.turnstile_token"
          :site-key="config.public.turnstileSiteKey"
          action="register"
        />

        <UButton type="submit" block :label="t('auth.register.submit')" icon="i-lucide-user-round-plus" :loading="submitting" />
      </UForm>

      <template #footer>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="text-sm text-muted">
            {{ redirectTarget === '/console/team' ? t('auth.register.default_redirect') : t('auth.register.redirect', { target: redirectTarget }) }}
          </div>
          <div class="text-sm text-muted">
            {{ t('auth.register.has_account') }}
            <ULink :to="loginTo" class="font-medium">
              {{ t('auth.register.back_login') }}
            </ULink>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton :label="t('auth.browse_games')" icon="i-lucide-trophy" to="/games" variant="ghost" />
            <UButton :label="t('auth.register.back_login')" icon="i-lucide-log-in" :to="loginTo" variant="outline" :disabled="submitting" />
          </div>
        </div>
      </template>
    </UPageCard>
  </div>
</template>
