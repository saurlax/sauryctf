<script setup lang="ts">
const { login } = useAuth()
const router = useRouter()
const toast = useToast()

const form = reactive({
  username: '',
  password: '',
})
const loading = ref(false)

async function handleLogin() {
  if (!form.username || !form.password) {
    toast.add({ title: '请填写完整信息', color: 'error' })
    return
  }
  loading.value = true
  try {
    await login(form.username, form.password)
    toast.add({ title: '登录成功', color: 'success' })
    router.push('/console')
  }
  catch (e: any) {
    toast.add({
      title: '登录失败',
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
        <h1 class="text-2xl font-bold text-center">登录</h1>
      </template>

      <UForm :state="form" class="space-y-4" @submit="handleLogin">
        <UFormField label="用户名" name="username">
          <UInput
            v-model="form.username"
            placeholder="请输入用户名"
            icon="i-lucide-user"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <UFormField label="密码" name="password">
          <UInput
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            icon="i-lucide-lock"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <UButton
          type="submit"
          label="登录"
          :loading="loading"
          size="lg"
          block
        />
      </UForm>

      <template #footer>
        <p class="text-center text-sm text-muted">
          还没有账号？
          <UButton variant="link" to="/register" label="立即注册" class="px-1" />
        </p>
      </template>
    </UPageCard>
  </div>
</template>
