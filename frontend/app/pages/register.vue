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

const onboardingCards = [
  {
    title: '1. 创建账号',
    description: '注册成功后会直接建立登录态，不需要再回头手动登录一次。',
    icon: 'i-lucide-user-round-plus',
  },
  {
    title: '2. 准备队伍',
    description: '系统会优先把你带去队伍相关入口，创建或加入队伍后再继续参赛。',
    icon: 'i-lucide-users',
  },
  {
    title: '3. 回到比赛',
    description: '如果你是从比赛详情页过来的，完成组队后会自动回到原比赛继续报名。',
    icon: 'i-lucide-flag',
  },
]

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
  return {
    path: '/console',
    query: {
      onboarding: 'team',
    },
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
          <ULink :to="loginTo" class="font-medium">
            去登录页面
          </ULink>
        </div>
      </UPageCard>

      <div class="space-y-6">
        <UAlert
          color="info"
          variant="soft"
          icon="i-lucide-route"
          title="注册后的最短路径"
          description="推荐顺序是先注册、再准备队伍、最后回到比赛详情页完成报名和提交。"
        />

        <UPageGrid :cols="{ default: 1, sm: 3, xl: 1 }">
          <UPageCard
            v-for="card in onboardingCards"
            :key="card.title"
            :title="card.title"
            :description="card.description"
            :icon="card.icon"
          />
        </UPageGrid>
      </div>
    </div>
  </div>
</template>
