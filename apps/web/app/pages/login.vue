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
const submitting = ref(false)

const redirectTarget = computed(() => {
  return resolveAuthRedirect(route.query.redirect, '/console')
})

const loginSchema = z.object({
  username: z.string().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
  turnstile_token: z.string().optional(),
})

type LoginSchema = z.output<typeof loginSchema>

async function onLogin(payload: FormSubmitEvent<LoginSchema>) {
  submitting.value = true
  try {
    await login(payload.data.username, payload.data.password, payload.data.turnstile_token)
    toast.add({ title: '登录成功', color: 'success' })
    await router.push(resolveRedirect())
  }
  catch (e: any) {
    toast.add({ title: '登录失败', description: controlPlaneErrorMessage(e), color: 'error' })
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
      title="登录"
      description="使用已有账号访问平台。"
      icon="i-lucide-lock"
    >
      <UForm :schema="loginSchema" :state="state" class="space-y-4" @submit="onLogin">
        <UFormField name="username" label="用户名或邮箱" required>
          <UInput v-model="state.username" class="w-full" placeholder="请输入用户名或邮箱" :disabled="submitting" />
        </UFormField>

        <UFormField name="password" label="密码" required>
          <UInput v-model="state.password" class="w-full" type="password" placeholder="请输入密码" :disabled="submitting" />
        </UFormField>

        <TurnstileField
          v-if="config.public.turnstileSiteKey"
          v-model="state.turnstile_token"
          :site-key="config.public.turnstileSiteKey"
          action="login"
        />

        <UButton type="submit" block label="登录" icon="i-lucide-log-in" :loading="submitting" />
      </UForm>

      <template #footer>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="text-sm text-muted">
            {{ redirectTarget === '/console' ? '登录后默认进入控制台。' : `登录后将返回 ${redirectTarget}。` }}
          </div>
          <div class="text-sm text-muted">
            还没有账号？
            <ULink :to="registerTo" class="font-medium">
              前往注册
            </ULink>
          </div>
          <ULink to="/forgot-password" class="text-sm font-medium">忘记密码</ULink>
          <div class="flex flex-wrap gap-2">
            <UButton label="浏览比赛" icon="i-lucide-trophy" to="/games" variant="ghost" />
            <UButton label="注册" icon="i-lucide-user-round-plus" :to="registerTo" variant="outline" :disabled="submitting" />
          </div>
        </div>
      </template>
    </UPageCard>
  </div>
</template>
