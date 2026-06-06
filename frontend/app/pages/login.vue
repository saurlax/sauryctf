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

const redirectTarget = computed(() => {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/')) {
    return redirect
  }

  return '/console'
})

const loginSchema = z.object({
  username: z.string().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
})

type LoginSchema = z.output<typeof loginSchema>

async function onLogin(payload: FormSubmitEvent<LoginSchema>) {
  try {
    await login(payload.data.username, payload.data.password)
    toast.add({ title: '登录成功', color: 'success' })
    await router.push(resolveRedirect())
  }
  catch (e: any) {
    toast.add({ title: '登录失败', description: e.data?.message || e.message, color: 'error' })
  }
}

function resolveRedirect() {
  return redirectTarget.value
}

const registerTo = computed(() => {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/')) {
    return `/register?redirect=${encodeURIComponent(redirect)}`
  }

  return '/register'
})

const state = reactive<Partial<LoginSchema>>({
  username: '',
  password: '',
})
</script>

<template>
  <div class="py-8">
    <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.05fr)_360px] xl:items-start">
      <UPageCard
        title="登录"
        description="使用已有账号登录，进入控制台或比赛页面。"
        icon="i-lucide-lock"
      >
        <UForm :schema="loginSchema" :state="state" class="space-y-4" @submit="onLogin">
          <UFormField name="username" label="用户名或邮箱" required>
            <UInput v-model="state.username" class="w-full" placeholder="请输入用户名或邮箱" />
          </UFormField>

          <UFormField name="password" label="密码" required>
            <UInput v-model="state.password" class="w-full" type="password" placeholder="请输入密码" />
          </UFormField>

          <UButton type="submit" block label="登录" icon="i-lucide-log-in" />
        </UForm>

        <div class="mt-4 text-sm text-muted">
          还没有账号？
          <ULink :to="registerTo" class="font-medium">
            前往注册
          </ULink>
        </div>
        <template #footer>
          <div class="flex flex-wrap gap-2">
            <UButton label="浏览比赛" icon="i-lucide-trophy" to="/games" variant="ghost" />
            <UButton label="前往注册" icon="i-lucide-user-round-plus" :to="registerTo" variant="outline" />
          </div>
        </template>
      </UPageCard>
    </div>
  </div>
</template>
