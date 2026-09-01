<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({
  middleware: 'guest',
})

const { login } = useAuth()
const router = useRouter()
const route = useRoute()
const toast = useToast()
const config = useRuntimeConfig()
const { errorMessage, platformSettings, t } = usePlatformUi()
const submitting = ref(false)

const redirectTarget = computed(() => {
  return resolveAuthRedirect(route.query.redirect, '/console')
})

const loginSchema = computed(() => z.object({
  username: z.string().min(1, t('validation.username_required')),
  password: z.string().min(1, t('validation.password_required')),
  turnstile_token: z.string().optional(),
}))

interface LoginSchema {
  username: string
  password: string
  turnstile_token?: string
}

async function onLogin(payload: FormSubmitEvent<LoginSchema>) {
  submitting.value = true
  try {
    await login(payload.data.username, payload.data.password, payload.data.turnstile_token)
    toast.add({ title: t('auth.login.success'), color: 'success' })
    await router.push(resolveRedirect())
  }
  catch (e: any) {
    toast.add({ title: t('auth.login.failed'), description: errorMessage(e), color: 'error' })
  }
  finally {
    submitting.value = false
  }
}

function resolveRedirect() {
  return redirectTarget.value
}

const registerTo = computed(() => {
  return buildAuthEntryPath('/register', redirectTarget.value)
})

const state = reactive<Partial<LoginSchema>>({
  username: '',
  password: '',
  turnstile_token: '',
})
</script>

<template>
  <div class="mx-auto max-w-xl py-8">
    <UPageCard
      :title="t('auth.login.title')"
      :description="t('auth.login.description')"
      icon="i-lucide-lock"
    >
      <UForm :schema="loginSchema" :state="state" class="space-y-4" @submit="onLogin">
        <UFormField name="username" :label="t('auth.login.username')" required>
          <UInput v-model="state.username" class="w-full" :placeholder="t('auth.login.username_placeholder')" :disabled="submitting" />
        </UFormField>

        <UFormField name="password" :label="t('auth.password')" required>
          <UInput v-model="state.password" class="w-full" type="password" :placeholder="t('auth.password_placeholder')" :disabled="submitting" />
        </UFormField>

        <TurnstileField
          v-if="config.public.turnstileSiteKey"
          v-model="state.turnstile_token"
          :site-key="config.public.turnstileSiteKey"
          action="login"
        />

        <UButton type="submit" block :label="t('auth.login.submit')" icon="i-lucide-log-in" :loading="submitting" />
      </UForm>

      <template #footer>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="text-sm text-muted">
            {{ redirectTarget === '/console' ? t('auth.login.default_redirect') : t('auth.login.redirect', { target: redirectTarget }) }}
          </div>
          <div v-if="platformSettings.public_registration_enabled" class="text-sm text-muted">
            {{ t('auth.login.no_account') }}
            <ULink :to="registerTo" class="font-medium">
              {{ t('auth.login.go_register') }}
            </ULink>
          </div>
          <ULink to="/forgot-password" class="text-sm font-medium">{{ t('auth.login.forgot') }}</ULink>
          <div class="flex flex-wrap gap-2">
            <UButton :label="t('auth.browse_games')" icon="i-lucide-trophy" to="/games" variant="ghost" />
            <UButton
              v-if="platformSettings.public_registration_enabled"
              :label="t('nav.register')"
              icon="i-lucide-user-round-plus"
              :to="registerTo"
              variant="outline"
              :disabled="submitting"
            />
          </div>
        </div>
      </template>
    </UPageCard>
  </div>
</template>
