<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

const { authState, fetchUser, login } = useAuth()
const router = useRouter()
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
    router.push('/console')
  }
  catch (e: any) {
    toast.add({ title: '登录失败', description: e.data?.message || e.message, color: 'error' })
  }
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
    await router.push('/console')
  }
})
</script>

<template>
  <div class="flex min-h-[70vh] items-center justify-center">
    <UPageCard
      class="w-full max-w-md"
      title="登录/注册"
      description="当前版本优先提供开箱即用的默认管理员账号。"
      icon="i-lucide-lock"
    >
      <UAlert
        class="mb-4"
        color="info"
        variant="soft"
        title="默认管理员"
        description="用户名 admin，密码 sauryctf。首次启动空库时会自动创建。"
      />

      <UForm :schema="loginSchema" :state="state" class="space-y-4" @submit="onLogin">
        <UFormField name="username" label="用户名或邮箱" required>
          <UInput v-model="state.username" class="w-full" placeholder="请输入用户名或邮箱" />
        </UFormField>

        <UFormField name="password" label="密码" required>
          <UInput v-model="state.password" class="w-full" type="password" placeholder="请输入密码" />
        </UFormField>

        <UButton type="submit" block label="进入控制台" icon="i-lucide-log-in" />
      </UForm>
    </UPageCard>
  </div>
</template>
