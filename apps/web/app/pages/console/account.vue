<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

definePageMeta({ middleware: 'auth' })

const {
  authState,
  changeEmail,
  changePassword,
  ensureInitialized,
  requestEmailVerification,
} = useAuth()
const toast = useToast()

await ensureInitialized()

const passwordModalOpen = ref(false)
const emailModalOpen = ref(false)
const submitting = ref(false)
const resending = ref(false)

const passwordSchema = z.object({
  current_password: z.string().min(1, '请输入当前密码'),
  new_password: z.string().min(8, '新密码至少 8 个字符'),
  confirm_password: z.string().min(8, '请再次输入新密码'),
}).refine(value => value.new_password === value.confirm_password, {
  message: '两次输入的新密码不一致',
  path: ['confirm_password'],
})

const emailSchema = z.object({ email: z.string().email('请输入有效邮箱') })
type PasswordForm = z.output<typeof passwordSchema>
type EmailForm = z.output<typeof emailSchema>

const passwordState = reactive<Partial<PasswordForm>>({
  current_password: '',
  new_password: '',
  confirm_password: '',
})
const emailState = reactive<Partial<EmailForm>>({ email: authState.user?.email ?? '' })

const setupPending = computed(() => Boolean(
  authState.user?.must_change_password || !authState.user?.email_verified,
))
const accountRows = computed(() => [
  { label: '用户名', value: authState.user?.username ?? '-' },
  { label: '邮箱', value: authState.user?.email ?? '-' },
  { label: '邮箱状态', value: authState.user?.email_verified ? '已验证' : '待验证' },
  { label: '全局角色', value: authState.user?.role ?? '-' },
  { label: '账号状态', value: authState.user?.status === 'active' ? '正常' : '已封禁' },
])

async function submitPassword(event: FormSubmitEvent<PasswordForm>) {
  submitting.value = true
  try {
    await changePassword(event.data.current_password, event.data.new_password)
    passwordModalOpen.value = false
    Object.assign(passwordState, { current_password: '', new_password: '', confirm_password: '' })
    toast.add({ title: '密码已更新', description: '其他设备上的旧登录状态已失效。', color: 'success' })
  }
  catch (error) {
    toast.add({ title: '密码更新失败', description: controlPlaneErrorMessage(error), color: 'error' })
  }
  finally {
    submitting.value = false
  }
}

async function submitEmail(event: FormSubmitEvent<EmailForm>) {
  submitting.value = true
  try {
    await changeEmail(event.data.email)
    emailModalOpen.value = false
    emailState.email = authState.user?.email ?? event.data.email
    toast.add({ title: '邮箱已更新', description: '请发送并完成新邮箱的验证。', color: 'success' })
  }
  catch (error) {
    toast.add({ title: '邮箱更新失败', description: controlPlaneErrorMessage(error), color: 'error' })
  }
  finally {
    submitting.value = false
  }
}

async function resendVerification() {
  resending.value = true
  try {
    await requestEmailVerification()
    toast.add({ title: '验证邮件已进入发送队列', color: 'success' })
  }
  catch (error) {
    toast.add({ title: '发送失败', description: controlPlaneErrorMessage(error), color: 'error' })
  }
  finally {
    resending.value = false
  }
}
</script>

<template>
  <div class="py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold">账号与安全</h1>
      <p class="mt-1 text-muted">维护登录凭证、邮箱和验证状态。</p>
    </div>

    <div v-if="setupPending" class="mb-6 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="font-medium text-highlighted">账号安全设置尚未完成</div>
          <p class="mt-1 text-sm text-muted">
            请完成{{ authState.user?.must_change_password ? '密码更新' : '' }}{{ authState.user?.must_change_password && !authState.user?.email_verified ? '和' : '' }}{{ !authState.user?.email_verified ? '邮箱验证' : '' }}后使用比赛及管理能力。
          </p>
        </div>
        <UBadge color="warning" variant="soft">受限</UBadge>
      </div>
    </div>

    <UPageGrid :cols="{ default: 1, lg: 2 }">
      <UPageCard title="账号信息" icon="i-lucide-user-round">
        <div class="divide-y divide-default">
          <div v-for="row in accountRows" :key="row.label" class="flex justify-between gap-4 py-3 text-sm">
            <span class="text-muted">{{ row.label }}</span>
            <span class="text-right font-medium">{{ row.value }}</span>
          </div>
        </div>
      </UPageCard>

      <UPageCard title="安全维护" icon="i-lucide-shield-check">
        <div class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default p-4">
            <div><div class="font-medium">登录密码</div><p class="mt-1 text-sm text-muted">更新后会撤销其他设备上的旧 Cookie。</p></div>
            <UButton icon="i-lucide-key-round" @click="() => { passwordModalOpen = true }">修改密码</UButton>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default p-4">
            <div><div class="font-medium">登录邮箱</div><p class="mt-1 text-sm text-muted">变更邮箱后必须重新验证。</p></div>
            <UButton variant="outline" icon="i-lucide-mail" @click="() => { emailModalOpen = true }">修改邮箱</UButton>
          </div>
          <div v-if="!authState.user?.email_verified" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default p-4">
            <div><div class="font-medium">邮箱验证</div><p class="mt-1 text-sm text-muted">验证链接为一次性凭证，并会按有效期失效。</p></div>
            <UButton variant="outline" icon="i-lucide-send" :loading="resending" @click="resendVerification">重发验证邮件</UButton>
          </div>
        </div>
      </UPageCard>
    </UPageGrid>

    <UModal v-model:open="passwordModalOpen" title="修改密码" :dismissible="!submitting" :ui="{ footer: 'justify-end' }">
      <template #body>
        <UForm id="account-password-form" :schema="passwordSchema" :state="passwordState" class="space-y-4" @submit="submitPassword">
          <UFormField name="current_password" label="当前密码" required><UInput v-model="passwordState.current_password" type="password" class="w-full" /></UFormField>
          <UFormField name="new_password" label="新密码" required><UInput v-model="passwordState.new_password" type="password" class="w-full" /></UFormField>
          <UFormField name="confirm_password" label="确认新密码" required><UInput v-model="passwordState.confirm_password" type="password" class="w-full" /></UFormField>
        </UForm>
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" :disabled="submitting" @click="() => { passwordModalOpen = false }">取消</UButton>
        <UButton type="submit" form="account-password-form" :loading="submitting">保存</UButton>
      </template>
    </UModal>

    <UModal v-model:open="emailModalOpen" title="修改邮箱" :dismissible="!submitting" :ui="{ footer: 'justify-end' }">
      <template #body>
        <UForm id="account-email-form" :schema="emailSchema" :state="emailState" @submit="submitEmail">
          <UFormField name="email" label="新邮箱" required><UInput v-model="emailState.email" type="email" class="w-full" /></UFormField>
        </UForm>
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" :disabled="submitting" @click="() => { emailModalOpen = false }">取消</UButton>
        <UButton type="submit" form="account-email-form" :loading="submitting">保存</UButton>
      </template>
    </UModal>
  </div>
</template>
