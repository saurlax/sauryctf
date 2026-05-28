<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent, AuthFormField } from '@nuxt/ui'

const { login, register } = useAuth()
const router = useRouter()
const toast = useToast()

const tab = ref('login')

// --- Login ---
const loginFields: AuthFormField[] = [
  { name: 'username', label: '用户名', type: 'text', placeholder: '请输入用户名', required: true },
  { name: 'password', label: '密码', type: 'password', placeholder: '请输入密码', required: true },
]

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

// --- Register ---
const registerFields: AuthFormField[] = [
  { name: 'username', label: '用户名', type: 'text', placeholder: '请输入用户名', required: true },
  { name: 'email', label: '邮箱', type: 'email', placeholder: '请输入邮箱', required: true },
  { name: 'password', label: '密码', type: 'password', placeholder: '请输入密码（至少 6 位）', required: true },
  { name: 'confirmPassword', label: '确认密码', type: 'password', placeholder: '请再次输入密码', required: true },
]

const registerSchema = z.object({
  username: z.string().min(1, '请输入用户名'),
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(6, '密码至少 6 位'),
  confirmPassword: z.string().min(1, '请确认密码'),
}).refine(data => data.password === data.confirmPassword, {
  message: '两次密码不一致',
  path: ['confirmPassword'],
})

type RegisterSchema = z.output<typeof registerSchema>

async function onRegister(payload: FormSubmitEvent<RegisterSchema>) {
  try {
    await register(payload.data.username, payload.data.email, payload.data.password)
    toast.add({ title: '注册成功', color: 'success' })
    router.push('/console')
  }
  catch (e: any) {
    toast.add({ title: '注册失败', description: e.data?.message || e.message, color: 'error' })
  }
}

const tabs = [
  { label: '登录', value: 'login' },
  { label: '注册', value: 'register' },
]
</script>

<template>
  <div class="flex justify-center items-center min-h-[60vh]">
    <UPageCard class="w-full max-w-md">
      <UTabs v-model="tab" :items="tabs" class="mb-4" />

      <UAuthForm
        v-if="tab === 'login'"
        :schema="loginSchema"
        :fields="loginFields"
        title="登录"
        icon="i-lucide-lock"
        @submit="onLogin"
      />

      <UAuthForm
        v-else
        :schema="registerSchema"
        :fields="registerFields"
        title="注册"
        icon="i-lucide-user-plus"
        @submit="onRegister"
      />
    </UPageCard>
  </div>
</template>
