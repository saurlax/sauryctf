<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

const { authState, fetchUser, login } = useAuth()
const router = useRouter()
const route = useRoute()
const toast = useToast()

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
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/')) {
    return redirect
  }
  return '/console'
}

const state = reactive<Partial<LoginSchema>>({
  username: 'admin',
  password: 'sauryctf',
})

onMounted(async () => {
  if (!authState.user) {
    await fetchUser()
  }

  if (authState.user) {
    await router.push(resolveRedirect())
  }
})
</script>

<template>
  <div class="flex min-h-[70vh] items-center justify-center">
    <UPageCard
      class="w-full max-w-md"
      title="登录"
      description="使用已有账号登录，进入控制台或比赛页面。"
      icon="i-lucide-lock"
    >
      <UAlert
        class="mb-4"
        color="info"
        variant="soft"
        title="默认管理员入口"
        description="只有在系统首次启动且 users 表为空时，后端才会初始化 admin / sauryctf。"
      />

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
        <ULink :to="route.query.redirect ? `/register?redirect=${route.query.redirect}` : '/register'" class="font-medium">
          去注册
        </ULink>
      </div>
    </UPageCard>
  </div>
</template>
