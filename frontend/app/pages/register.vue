<script setup lang="ts">
const { register } = useAuth()
const router = useRouter()
const toast = useToast()

const form = reactive({
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
})
const loading = ref(false)

async function handleRegister() {
  if (!form.username || !form.email || !form.password) {
    toast.add({ title: '请填写完整信息', color: 'error' })
    return
  }
  if (form.password !== form.confirmPassword) {
    toast.add({ title: '两次密码不一致', color: 'error' })
    return
  }
  if (form.password.length < 6) {
    toast.add({ title: '密码至少 6 位', color: 'error' })
    return
  }
  loading.value = true
  try {
    await register(form.username, form.email, form.password)
    toast.add({ title: '注册成功', color: 'success' })
    router.push('/console')
  }
  catch (e: any) {
    toast.add({
      title: '注册失败',
      description: e.data?.message || e.message,
      color: 'error',
    })
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex justify-center items-center min-h-[60vh]">
    <UPageCard class="w-full max-w-md">
      <template #header>
        <h1 class="text-2xl font-bold text-center">注册</h1>
      </template>

      <UForm :state="form" class="space-y-4" @submit="handleRegister">
        <UFormField label="用户名" name="username">
          <UInput
            v-model="form.username"
            placeholder="请输入用户名"
            icon="i-lucide-user"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <UFormField label="邮箱" name="email">
          <UInput
            v-model="form.email"
            type="email"
            placeholder="请输入邮箱"
            icon="i-lucide-mail"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <UFormField label="密码" name="password">
          <UInput
            v-model="form.password"
            type="password"
            placeholder="请输入密码（至少 6 位）"
            icon="i-lucide-lock"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <UFormField label="确认密码" name="confirmPassword">
          <UInput
            v-model="form.confirmPassword"
            type="password"
            placeholder="请再次输入密码"
            icon="i-lucide-lock"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <UButton
          type="submit"
          label="注册"
          :loading="loading"
          size="lg"
          block
        />
      </UForm>

      <template #footer>
        <p class="text-center text-sm text-muted">
          已有账号？
          <UButton variant="link" to="/login" label="立即登录" class="px-1" />
        </p>
      </template>
    </UPageCard>
  </div>
</template>
