<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({
  middleware: 'guest',
})

const { register } = useAuth()
const router = useRouter()
const route = useRoute()
const toast = useToast()

const registerSchema = z.object({
  username: z.string().min(2, '用户名至少 2 个字符'),
  email: z.string().email('请输入有效邮箱'),
  password: z.string().min(6, '密码至少 6 个字符'),
})

type RegisterSchema = z.output<typeof registerSchema>

const state = reactive<Partial<RegisterSchema>>({
  username: '',
  email: '',
  password: '',
})

async function onRegister(payload: FormSubmitEvent<RegisterSchema>) {
  try {
    await register(payload.data.username, payload.data.email, payload.data.password)
    toast.add({ title: '注册成功', description: '已自动登录，正在跳转。', color: 'success' })
    await router.push(resolveRedirect())
  }
  catch (e: any) {
    toast.add({ title: '注册失败', description: e.data?.message || e.message, color: 'error' })
  }
}

function resolveRedirect() {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/')) {
    return {
      path: '/console/team',
      query: {
        redirect,
      },
    }
  }
  return '/console'
}
</script>

<template>
  <div class="flex min-h-[70vh] items-center justify-center">
    <UPageCard
      class="w-full max-w-md"
      title="注册"
      description="创建一个新的选手账号，注册成功后会直接登录；如果你是从比赛页进来的，接下来会先带你去准备队伍。"
      icon="i-lucide-user-plus"
    >
      <UForm :schema="registerSchema" :state="state" class="space-y-4" @submit="onRegister">
        <UFormField name="username" label="用户名" required>
          <UInput v-model="state.username" class="w-full" placeholder="例如 saury" />
        </UFormField>

        <UFormField name="email" label="邮箱" required>
          <UInput v-model="state.email" class="w-full" type="email" placeholder="you@example.com" />
        </UFormField>

        <UFormField name="password" label="密码" required>
          <UInput v-model="state.password" class="w-full" type="password" placeholder="至少 6 个字符" />
        </UFormField>

        <UButton type="submit" block label="创建账号" icon="i-lucide-user-round-plus" />
      </UForm>

      <div class="mt-4 text-sm text-muted">
        已有账号？
        <ULink :to="route.query.redirect ? `/login?redirect=${route.query.redirect}` : '/login'" class="font-medium">
          去登录页面
        </ULink>
      </div>
    </UPageCard>
  </div>
</template>
