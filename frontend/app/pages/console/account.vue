<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({
  middleware: 'auth',
})

const { authState, ensureInitialized } = useAuth()
const toast = useToast()

const { data: setupStatus, refresh: refreshSetupStatus } = await useAPI('auth-setup-status', 'get', '/api/auth/setup-status')

const securitySchema = z.object({
  current_password: z.string().min(6, '当前密码至少 6 个字符'),
  new_password: z.string().min(6, '新密码至少 6 个字符'),
  confirm_password: z.string().min(6, '确认密码至少 6 个字符'),
}).refine(value => value.new_password === value.confirm_password, {
  message: '两次输入的新密码不一致',
  path: ['confirm_password'],
})

type SecuritySchema = z.output<typeof securitySchema>

const state = reactive<Partial<SecuritySchema>>({
  current_password: '',
  new_password: '',
  confirm_password: '',
})

const submitting = ref(false)
const bootstrapRisk = computed(() => !!setupStatus.value?.password_change_recommended)
const securityNextStepMeta = computed(() => {
  if (bootstrapRisk.value) {
    return {
      title: '建议优先更新登录密码',
      description: '当前管理员账号仍在使用默认口令。完成改密后再继续日常管理操作会更安全。',
      color: 'warning' as const,
      icon: 'i-lucide-triangle-alert',
      actionLabel: '打开管理端',
      actionTo: '/console/admin',
      secondaryLabel: '返回控制台',
      secondaryTo: '/console',
    }
  }

  return {
    title: '账号可继续使用',
    description: '当前账号安全状态正常，可以返回控制台继续处理比赛、队伍或其他待办。',
    color: 'success' as const,
    icon: 'i-lucide-shield-check',
    actionLabel: '返回控制台',
    actionTo: '/console',
    secondaryLabel: '浏览比赛',
    secondaryTo: '/games',
  }
})

const accountFacts = computed(() => [
  {
    label: '用户名',
    value: authState.user?.username || '-',
    icon: 'i-lucide-user',
  },
  {
    label: '邮箱',
    value: authState.user?.email || '-',
    icon: 'i-lucide-mail',
  },
  {
    label: '角色',
    value: authState.user?.role || '-',
    icon: 'i-lucide-shield',
  },
  {
    label: '状态',
    value: authState.user?.status || '-',
    icon: 'i-lucide-badge-check',
  },
])

const securityFacts = computed(() => [
  {
    label: '风险级别',
    value: bootstrapRisk.value ? '需要改密' : '正常',
    icon: bootstrapRisk.value ? 'i-lucide-triangle-alert' : 'i-lucide-shield-check',
  },
  {
    label: '当前会话',
    value: '改密后不立即退出',
    icon: 'i-lucide-key-round',
  },
  {
    label: '推荐操作',
    value: bootstrapRisk.value ? '改密后返回管理端' : '返回控制台继续使用',
    icon: 'i-lucide-navigation',
  },
])

async function submitPasswordChange(payload: FormSubmitEvent<SecuritySchema>) {
  submitting.value = true
  try {
    await $api('post', '/api/auth/change-password', {
      body: {
        current_password: payload.data.current_password,
        new_password: payload.data.new_password,
      },
    })
    state.current_password = ''
    state.new_password = ''
    state.confirm_password = ''
    await refreshSetupStatus()
    toast.add({
      title: '密码已更新',
      description: '新的登录密码已经生效，请妥善保管。',
      color: 'success',
    })
  }
  catch (e: any) {
    toast.add({ title: '修改失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await ensureInitialized()
  await refreshSetupStatus()
})
</script>

<template>
  <div class="py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold">
        账号安全
      </h1>
      <p class="mt-1 text-muted">
        管理当前账号信息，并及时更新登录密码。
      </p>
    </div>

    <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
      <div class="space-y-6">
        <UAlert
          :color="securityNextStepMeta.color"
          variant="soft"
          :icon="securityNextStepMeta.icon"
          :title="securityNextStepMeta.title"
          :description="securityNextStepMeta.description"
        >
          <template #actions>
            <div class="flex flex-wrap gap-2">
              <UButton
                size="sm"
                :to="securityNextStepMeta.actionTo"
                :label="securityNextStepMeta.actionLabel"
                variant="outline"
              />
              <UButton
                v-if="securityNextStepMeta.secondaryLabel && securityNextStepMeta.secondaryTo"
                size="sm"
                :to="securityNextStepMeta.secondaryTo"
                :label="securityNextStepMeta.secondaryLabel"
                variant="ghost"
              />
            </div>
          </template>
        </UAlert>

        <UPageCard title="修改密码" icon="i-lucide-key-round">
          <UAlert
            v-if="bootstrapRisk"
            class="mb-4"
            color="warning"
            variant="soft"
            icon="i-lucide-triangle-alert"
            title="初始管理员账号仍在使用初始密码"
            description="当前账号仍在使用平台首次启动时的默认口令。为避免长期保留高风险凭据，请尽快更新为新的管理员密码。"
          />

          <UForm :schema="securitySchema" :state="state" class="space-y-4" @submit="submitPasswordChange">
            <UFormField name="current_password" label="当前密码" required>
              <UInput v-model="state.current_password" type="password" class="w-full" placeholder="输入当前密码" />
            </UFormField>

            <UFormField name="new_password" label="新密码" required>
              <UInput v-model="state.new_password" type="password" class="w-full" placeholder="至少 6 个字符" />
            </UFormField>

            <UFormField name="confirm_password" label="确认新密码" required>
              <UInput v-model="state.confirm_password" type="password" class="w-full" placeholder="再次输入新密码" />
            </UFormField>

            <UButton type="submit" label="更新密码" icon="i-lucide-save" :loading="submitting" block />
          </UForm>

          <template #footer>
            <div class="text-sm text-muted">
              修改密码后，当前登录态不会立刻失效；后续重新登录时请改用新密码。
            </div>
          </template>
        </UPageCard>
      </div>

      <div class="space-y-6">
        <UPageCard title="当前账号" icon="i-lucide-user-cog">
          <div class="space-y-3 text-sm">
            <div
              v-for="item in accountFacts"
              :key="item.label"
              class="flex items-center justify-between gap-3 rounded-lg border border-default px-3 py-3"
            >
              <div class="flex items-center gap-2 text-muted">
                <UIcon :name="item.icon" class="size-4" />
                <span>{{ item.label }}</span>
              </div>
              <span class="text-right">{{ item.value }}</span>
            </div>
          </div>
        </UPageCard>

        <UPageCard title="安全状态" icon="i-lucide-shield-check">
          <div class="space-y-3">
            <div class="rounded-lg border border-default px-3 py-3 text-sm text-muted">
              <div
                v-for="item in securityFacts"
                :key="item.label"
                class="flex items-center justify-between gap-3 py-2"
              >
                <div class="flex items-center gap-2 text-muted">
                  <UIcon :name="item.icon" class="size-4" />
                  <span>{{ item.label }}</span>
                </div>
                <span class="text-right">{{ item.value }}</span>
              </div>
            </div>
          </div>
        </UPageCard>
      </div>
    </div>
  </div>
</template>
