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
const submitting = ref(false)

const redirectTarget = computed(() => {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/')) {
    return redirect
  }
  return '/console/team'
})

const registerSchema = z.object({
  username: z.string().min(3, '用户名至少 3 个字符'),
  email: z.string().email('请输入有效邮箱'),
  password: z.string().min(6, '密码至少 6 个字符'),
  confirm_password: z.string().min(6, '确认密码至少 6 个字符'),
}).refine(value => value.password === value.confirm_password, {
  message: '两次输入的密码不一致',
  path: ['confirm_password'],
})

type RegisterSchema = z.output<typeof registerSchema>

const state = reactive<Partial<RegisterSchema>>({
  username: '',
  email: '',
  password: '',
  confirm_password: '',
})

async function onRegister(payload: FormSubmitEvent<RegisterSchema>) {
  submitting.value = true
  try {
    await register(payload.data.username, payload.data.email, payload.data.password)
    toast.add({ title: '注册成功', description: '已自动登录，正在跳转。', color: 'success' })
    await router.push(resolveRedirect())
  }
  catch (e: any) {
    toast.add({ title: '注册失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    submitting.value = false
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
  return {
    path: '/console/team',
  }
}

const loginTo = computed(() => {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/')) {
    return `/login?redirect=${encodeURIComponent(redirect)}`
  }

  return '/login'
})
</script>

<template>
  <div class="mx-auto max-w-xl py-8">
    <UPageCard
      title="注册"
      description="创建平台账号。注册成功后会自动登录。"
      icon="i-lucide-user-plus"
    >
      <UForm :schema="registerSchema" :state="state" class="space-y-4" @submit="onRegister">
        <UFormField name="username" label="用户名" required>
          <UInput v-model="state.username" class="w-full" placeholder="请输入用户名" :disabled="submitting" />
        </UFormField>

        <UFormField name="email" label="邮箱" required>
          <UInput v-model="state.email" class="w-full" type="email" placeholder="请输入邮箱" :disabled="submitting" />
        </UFormField>

        <UFormField name="password" label="密码" required>
          <UInput v-model="state.password" class="w-full" type="password" placeholder="请输入密码" :disabled="submitting" />
        </UFormField>

        <UFormField name="confirm_password" label="确认密码" required>
          <UInput v-model="state.confirm_password" class="w-full" type="password" placeholder="请再次输入密码" :disabled="submitting" />
        </UFormField>

        <UButton type="submit" block label="注册账号" icon="i-lucide-user-round-plus" :loading="submitting" />
      </UForm>

      <template #footer>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="text-sm text-muted">
            {{ redirectTarget === '/console/team' ? '注册后默认进入队伍页。' : `注册后会先进入队伍页，并保留返回目标 ${redirectTarget}。` }}
          </div>
          <div class="text-sm text-muted">
            已有账号？
            <ULink :to="loginTo" class="font-medium">
              返回登录
            </ULink>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton label="浏览比赛" icon="i-lucide-trophy" to="/games" variant="ghost" />
            <UButton label="返回登录" icon="i-lucide-log-in" :to="loginTo" variant="outline" :disabled="submitting" />
          </div>
        </div>
      </template>
    </UPageCard>
  </div>
</template>
