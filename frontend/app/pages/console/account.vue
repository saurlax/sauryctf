<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({
  middleware: 'auth',
})

const { authState, ensureInitialized, redirectToLogin } = useAuth()
const toast = useToast()

const { data: securityStatus, refresh: refreshSecurityStatus } = await useAPI('auth-security-status', 'get', '/api/auth/security-status')

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
const passwordModalOpen = ref(false)
const passwordSecurityRisk = computed(() => !!securityStatus.value?.password_change_recommended)
const securityNextStepMeta = computed(() => {
  if (passwordSecurityRisk.value) {
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
    value: passwordSecurityRisk.value ? '需要改密' : '正常',
    icon: passwordSecurityRisk.value ? 'i-lucide-triangle-alert' : 'i-lucide-shield-check',
  },
  {
    label: '当前会话',
    value: '改密后需要重新登录',
    icon: 'i-lucide-key-round',
  },
  {
    label: '推荐操作',
    value: passwordSecurityRisk.value ? '改密后返回管理端' : '返回控制台继续使用',
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
    passwordModalOpen.value = false
    toast.add({
      title: '密码已更新',
      description: '当前账号已退出登录，请使用新密码重新登录。',
      color: 'success',
    })
    await redirectToLogin()
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
  await refreshSecurityStatus()
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
          <div class="space-y-4">
            <UAlert
              v-if="passwordSecurityRisk"
              color="warning"
              variant="soft"
              icon="i-lucide-triangle-alert"
              title="初始管理员账号仍在使用初始密码"
              description="当前账号仍在使用平台首次启动时的默认口令。为避免长期保留高风险凭据，请尽快更新为新的管理员密码。"
            />

            <div class="rounded-lg border border-default px-4 py-4">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="space-y-1">
                  <div class="text-sm font-medium">
                    登录密码维护
                  </div>
                  <p class="text-sm text-muted">
                    密码修改属于低频敏感操作，提交前请确认当前账号与新密码信息无误。
                  </p>
                </div>

                <UButton
                  label="修改密码"
                  icon="i-lucide-key-round"
                  @click="passwordModalOpen = true"
                />
              </div>
            </div>
          </div>

          <template #footer>
            <div class="text-sm text-muted">
              修改密码后，当前账号会立即退出登录；后续请使用新密码重新登录。
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

    <UModal
      v-model:open="passwordModalOpen"
      title="修改密码"
      description="更新当前账号的登录密码。提交前请确认当前密码和新密码输入无误。"
      :dismissible="!submitting"
      :ui="{ body: 'space-y-4', footer: 'justify-end' }"
    >
      <template #body>
        <UAlert
          v-if="passwordSecurityRisk"
          color="warning"
          variant="soft"
          icon="i-lucide-triangle-alert"
          title="当前账号存在改密风险"
          description="初始管理员密码不应长期保留，请尽快完成更新。"
        />

        <UForm
          id="account-password-form"
          :schema="securitySchema"
          :state="state"
          class="space-y-4"
          @submit="submitPasswordChange"
        >
          <UFormField name="current_password" label="当前密码" required>
            <UInput v-model="state.current_password" type="password" class="w-full" placeholder="输入当前密码" />
          </UFormField>

          <UFormField name="new_password" label="新密码" required>
            <UInput v-model="state.new_password" type="password" class="w-full" placeholder="至少 6 个字符" />
          </UFormField>

          <UFormField name="confirm_password" label="确认新密码" required>
            <UInput v-model="state.confirm_password" type="password" class="w-full" placeholder="再次输入新密码" />
          </UFormField>
        </UForm>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="outline"
          :disabled="submitting"
          @click="passwordModalOpen = false"
        >
          取消
        </UButton>
        <UButton
          icon="i-lucide-save"
          type="submit"
          form="account-password-form"
          :loading="submitting"
        >
          更新密码
        </UButton>
      </template>
    </UModal>
  </div>
</template>
