<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({
  middleware: 'guest',
})

const { login } = useAuth()
const router = useRouter()
const route = useRoute()
const toast = useToast()
const { data: setupStatus } = await useAPI('auth-setup-status', 'get', '/api/auth/setup-status')

const redirectTarget = computed(() => {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/')) {
    return redirect
  }

  if (setupStatus.value?.bootstrap_admin_available) {
    return '/console/admin'
  }

  return '/console'
})

const quickLinks = computed(() => [
  {
    title: '浏览比赛',
    description: '先查看公开比赛、题目和排行榜，再决定后续操作。',
    icon: 'i-lucide-trophy',
    to: '/games',
  },
  {
    title: '注册账号',
    description: '新用户可先完成注册，再进入队伍与参赛流程。',
    icon: 'i-lucide-user-round-plus',
    to: registerTo.value,
  },
])

const afterLoginNotes = computed(() => {
  if (redirectTarget.value.startsWith('/games/')) {
    return [
      {
        title: '返回原比赛',
        description: '登录成功后会直接跳回刚才的比赛详情页，继续查看报名状态、题目和排行榜。',
        icon: 'i-lucide-undo-2',
      },
      {
        title: '按需准备队伍',
        description: '比赛报名、提 Flag 和排行榜都按队伍进行，缺队伍时再去队伍页处理会更顺。',
        icon: 'i-lucide-users',
      },
      {
        title: '继续比赛操作',
        description: '准备好队伍后，就可以回到比赛里完成报名、提交 Flag，或继续使用动态题实例能力。',
        icon: 'i-lucide-flag',
      },
    ]
  }

  return [
    {
      title: '进入控制台',
      description: '登录成功后默认会进入控制台，方便先确认当前账号、队伍和比赛待办。',
      icon: 'i-lucide-layout-dashboard',
    },
    {
      title: '按需准备队伍',
      description: '如果这是一个普通选手账号，接下来最值得先处理的是创建队伍或使用邀请码加入队伍。',
      icon: 'i-lucide-users',
    },
    {
      title: '回到比赛页继续操作',
      description: '准备好队伍后，再去公开比赛页完成报名、提交 Flag，或补交 Writeup。',
      icon: 'i-lucide-trophy',
    },
  ]
})

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
  return redirectTarget.value
}

const registerTo = computed(() => {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/')) {
    return `/register?redirect=${encodeURIComponent(redirect)}`
  }

  return '/register'
})

const state = reactive<Partial<LoginSchema>>({
  username: setupStatus.value?.bootstrap_admin_available ? setupStatus.value.default_admin_username || 'admin' : '',
  password: setupStatus.value?.bootstrap_admin_available ? setupStatus.value.default_admin_password || 'sauryctf' : '',
})
</script>

<template>
  <div class="py-8">
    <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.05fr)_360px] xl:items-start">
      <UPageCard
        title="登录"
        description="使用已有账号登录，进入控制台或比赛页面。"
        icon="i-lucide-lock"
      >
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
          <ULink :to="registerTo" class="font-medium">
            去注册页面
          </ULink>
        </div>
      </UPageCard>

      <div class="space-y-6">
        <UPageCard title="登录说明" icon="i-lucide-list-checks">
          <div class="space-y-3">
            <UAlert
              color="info"
              variant="soft"
              title="默认跳转位置"
              :description="redirectTarget"
            />

            <div
              v-for="item in afterLoginNotes"
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

        <UPageCard title="快速入口" icon="i-lucide-navigation">
          <div class="space-y-3">
            <div
              v-for="link in quickLinks"
              :key="link.title"
              class="rounded-lg border border-default px-3 py-3"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <UIcon :name="link.icon" class="size-4 shrink-0" />
                    <div class="font-medium">
                      {{ link.title }}
                    </div>
                  </div>
                  <div class="mt-2 text-sm text-muted">
                    {{ link.description }}
                  </div>
                </div>
                <UButton
                  size="sm"
                  variant="outline"
                  icon="i-lucide-arrow-right"
                  :to="link.to"
                >
                  前往
                </UButton>
              </div>
            </div>
          </div>
        </UPageCard>
      </div>
    </div>
  </div>
</template>
