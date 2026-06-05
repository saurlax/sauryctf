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

const redirectTarget = computed(() => {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/')) {
    return redirect
  }
  return '/console/team?onboarding=created'
})

const initialRegisterLanding = computed(() => {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/')) {
    return `/console/team?onboarding=created&redirect=${redirect}`
  }

  return '/console/team?onboarding=created'
})

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

const afterRegisterSteps = computed(() => {
  if (redirectTarget.value.startsWith('/games/')) {
    return [
      {
        title: '1. 先进入队伍页',
        description: '注册成功后会先带你去队伍页，而不是直接回比赛，这样你可以先把队伍准备完整。',
        icon: 'i-lucide-users',
      },
      {
        title: '2. 创建或加入队伍',
        description: '和 GZCTF 的常见参赛流程一样，账号只是第一步，真正参赛前还需要确定当前使用的队伍。',
        icon: 'i-lucide-user-round-plus',
      },
      {
        title: '3. 再回到原比赛报名',
        description: '准备好队伍后，系统会把你带回刚才的比赛详情页，继续报名、提 Flag 或启动实例。',
        icon: 'i-lucide-flag',
      },
    ]
  }

  return [
    {
      title: '1. 自动进入队伍页',
      description: '注册成功后会直接建立登录态，并进入队伍页，不需要再回头手动登录一次。',
      icon: 'i-lucide-layout-dashboard',
    },
    {
      title: '2. 先把队伍准备好',
      description: 'CTF 的报名、排行榜和动态实例都基于队伍进行，所以建议优先创建自己的队伍或加入现有队伍。',
      icon: 'i-lucide-users',
    },
    {
      title: '3. 再去比赛页继续参赛',
      description: '队伍准备完成后，再去公开比赛列表选择目标比赛并完成报名、提交 Flag 或补交 Writeup。',
      icon: 'i-lucide-trophy',
    },
  ]
})

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
        onboarding: 'created',
        redirect,
      },
    }
  }
  return {
    path: '/console/team',
    query: {
      onboarding: 'created',
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
        <UPageCard title="注册后下一步" icon="i-lucide-list-checks">
          <div class="space-y-3">
            <UAlert
              color="info"
              variant="soft"
              title="当前注册成功后的首个落点"
              :description="initialRegisterLanding"
            />

            <div
              v-for="item in afterRegisterSteps"
              :key="item.title"
              class="rounded-lg border border-default px-3 py-3"
            >
              <div class="flex items-start gap-3">
                <UIcon :name="item.icon" class="mt-0.5 size-4 shrink-0 text-primary" />
                <div class="min-w-0">
                  <div class="font-medium">
                    {{ item.title }}
                  </div>
                  <div class="mt-2 text-sm text-muted">
                    {{ item.description }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </UPageCard>

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
