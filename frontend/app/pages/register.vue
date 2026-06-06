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
  username: z.string().min(2, '用户名至少 2 个字符'),
  email: z.string().email('请输入有效邮箱'),
  password: z.string().min(6, '密码至少 6 个字符'),
})

type RegisterSchema = z.output<typeof registerSchema>

const registerSummaryRows = computed(() => [
  {
    label: '注册后首站',
    value: '/console/team',
  },
  {
    label: '后续返回',
    value: redirectTarget.value !== '/console/team' ? redirectTarget.value : '可继续浏览比赛或维护队伍',
  },
  {
    label: '注册结果',
    value: '成功后自动登录当前账号',
  },
])

const state = reactive<Partial<RegisterSchema>>({
  username: '',
  email: '',
  password: '',
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
  <div class="py-8">
    <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.05fr)_360px] xl:items-start">
      <UPageCard
        title="注册"
        description="创建选手账号。注册成功后会自动登录，并进入队伍页面。"
        icon="i-lucide-user-plus"
      >
        <UAlert
          color="info"
          variant="subtle"
          icon="i-lucide-route"
          title="注册后会先进入队伍页"
          :description="redirectTarget !== '/console/team'
            ? `系统会先进入 /console/team，并保留返回目标 ${redirectTarget}。`
            : '系统会先进入 /console/team，便于继续创建或加入队伍。'"
          class="mb-4"
        />

        <UForm :schema="registerSchema" :state="state" class="space-y-4" @submit="onRegister">
          <UFormField name="username" label="用户名" required>
            <UInput v-model="state.username" class="w-full" placeholder="例如 saury" :disabled="submitting" />
          </UFormField>

          <UFormField name="email" label="邮箱" required>
            <UInput v-model="state.email" class="w-full" type="email" placeholder="you@example.com" :disabled="submitting" />
          </UFormField>

          <UFormField name="password" label="密码" required>
            <UInput v-model="state.password" class="w-full" type="password" placeholder="至少 6 个字符" :disabled="submitting" />
          </UFormField>

          <UButton type="submit" block label="注册账号" icon="i-lucide-user-round-plus" :loading="submitting" />
        </UForm>

        <template #footer>
          <div class="flex flex-wrap items-center justify-between gap-3">
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

      <UPageCard
        title="注册摘要"
        description="注册页只负责建立账号并接续队伍与比赛链路。"
        icon="i-lucide-clipboard-check"
      >
        <div class="space-y-3 text-sm">
          <div
            v-for="row in registerSummaryRows"
            :key="row.label"
            class="flex items-center justify-between gap-3 rounded-md bg-elevated/60 px-3 py-2"
          >
            <span class="text-muted">{{ row.label }}</span>
            <span class="text-right">{{ row.value }}</span>
          </div>
        </div>
      </UPageCard>
    </div>
  </div>
</template>
