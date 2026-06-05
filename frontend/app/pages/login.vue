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
  return '/console'
})

const quickLinks = computed(() => {
  const links = [
    {
      title: '先看比赛列表',
      description: '游客也可以先浏览公开比赛和排行榜，再决定是否登录。',
      icon: 'i-lucide-trophy',
      to: '/games',
    },
    {
      title: '没有账号去注册',
      description: '普通选手注册后会自动登录，并进入队伍准备流程。',
      icon: 'i-lucide-user-round-plus',
      to: registerTo.value,
    },
  ]

  if (setupStatus.value?.bootstrap_admin_available) {
    links.unshift({
      title: '空库管理员入口',
      description: `当前可直接使用 ${setupStatus.value.default_admin_username} / ${setupStatus.value.default_admin_password} 登录管理端。`,
      icon: 'i-lucide-shield-check',
      to: '/console/admin',
    })
  }

  return links
})

const afterLoginSteps = computed(() => {
  if (redirectTarget.value.startsWith('/games/')) {
    return [
      {
        title: '1. 先回到原比赛',
        description: '登录成功后会直接跳回刚才的比赛详情页，继续查看报名状态、题目和排行榜。',
        icon: 'i-lucide-undo-2',
      },
      {
        title: '2. 如果还没有队伍，先去准备队伍',
        description: '比赛报名、提 Flag 和排行榜都按队伍进行，缺队伍时再去队伍页处理会更顺。',
        icon: 'i-lucide-users',
      },
      {
        title: '3. 再继续报名或启动实例',
        description: '准备好队伍后，就可以回到比赛里完成报名、提交 Flag，或继续验证动态题实例链路。',
        icon: 'i-lucide-flag',
      },
    ]
  }

  if (setupStatus.value?.bootstrap_admin_available) {
    return [
      {
        title: '1. 进入控制台',
        description: '空库场景下，登录成功后默认会进入控制台，方便你立刻开始管理员初始化。',
        icon: 'i-lucide-layout-dashboard',
      },
      {
        title: '2. 去管理端创建比赛',
        description: '推荐先创建一场公开比赛，再创建题目、挂题并激活，尽快打通最小联调闭环。',
        icon: 'i-lucide-settings-2',
      },
      {
        title: '3. 再注册普通选手验证参赛链路',
        description: '管理员链路确认后，再用普通账号走一遍建队、报名、提 Flag 和看榜。',
        icon: 'i-lucide-user-round-plus',
      },
    ]
  }

  return [
    {
      title: '1. 进入控制台',
      description: '登录成功后默认会进入控制台，方便先确认当前账号、队伍和比赛待办。',
      icon: 'i-lucide-layout-dashboard',
    },
    {
      title: '2. 没有队伍就先准备队伍',
      description: '如果这是一个普通选手账号，接下来最值得先处理的是创建队伍或使用邀请码加入队伍。',
      icon: 'i-lucide-users',
    },
    {
      title: '3. 再回到比赛页继续操作',
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
        <UAlert
          v-if="setupStatus?.bootstrap_admin_available"
          class="mb-4"
          color="info"
          variant="soft"
          title="默认管理员入口"
          :description="`当前库为空，可直接使用 ${setupStatus.default_admin_username} / ${setupStatus.default_admin_password} 登录。`"
        />

        <UAlert
          v-else
          class="mb-4"
          color="neutral"
          variant="soft"
          title="默认管理员已关闭"
          description="当前数据库里已经有用户，后端不会再补建默认 admin 账号。请使用现有账号登录。"
        />

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
        <UPageCard title="登录后下一步" icon="i-lucide-list-checks">
          <div class="space-y-3">
            <UAlert
              color="info"
              variant="soft"
              title="当前登录成功后的默认去向"
              :description="redirectTarget"
            />

            <div
              v-for="item in afterLoginSteps"
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
