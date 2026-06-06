<script setup lang="ts">
definePageMeta({
  middleware: 'admin',
})

import type { components } from '~/types/api'
import type { TableColumn } from '@nuxt/ui'

type UserInfo = components['schemas']['UserInfo']
type UserRole = NonNullable<UserInfo['role']>
type UserStatus = NonNullable<UserInfo['status']>

const { authState, ensureInitialized } = useAuth()
const toast = useToast()

const loading = ref(true)
const savingUserId = ref<number | null>(null)
const users = ref<UserInfo[]>([])
const saveConfirmModalOpen = ref(false)
const filters = reactive({
  keyword: '',
  role: 'all' as 'all' | UserRole,
  status: 'all' as 'all' | UserStatus,
})

const roleDrafts = reactive<Record<number, UserRole>>({})
const statusDrafts = reactive<Record<number, UserStatus>>({})
const pendingSaveTarget = ref<{
  user: UserInfo
  nextRole: UserRole
  nextStatus: UserStatus
} | null>(null)

const roleOptions = [
  { label: '普通用户', value: 'user' },
  { label: '队长', value: 'team_captain' },
  { label: '裁判', value: 'judge' },
  { label: '管理员', value: 'admin' },
  { label: '超级管理员', value: 'super_admin' },
]

const statusOptions = [
  { label: '正常', value: 'active' },
  { label: '封禁', value: 'banned' },
]

const totalUsers = computed(() => users.value.length)
const adminUsers = computed(() => users.value.filter(user => ['admin', 'super_admin'].includes(user.role)).length)
const bannedUsers = computed(() => users.value.filter(user => user.status === 'banned').length)
const currentUserId = computed(() => authState.user?.id || 0)
const currentUserRole = computed<UserRole | ''>(() => authState.user?.role || '')
const filterRoleOptions = computed(() => [{ label: '全部角色', value: 'all' as const }, ...roleOptions])
const filterStatusOptions = computed(() => [{ label: '全部状态', value: 'all' as const }, ...statusOptions])
const filteredUsers = computed(() => {
  const keyword = filters.keyword.trim().toLowerCase()

  return users.value.filter((user) => {
    const matchesKeyword = !keyword
      || user.username.toLowerCase().includes(keyword)
      || user.email.toLowerCase().includes(keyword)
      || String(user.id).includes(keyword)
    const matchesRole = filters.role === 'all' || user.role === filters.role
    const matchesStatus = filters.status === 'all' || user.status === filters.status

    return matchesKeyword && matchesRole && matchesStatus
  })
})
const activeFilterSummary = computed(() => {
  const items: string[] = []

  if (filters.keyword.trim()) {
    items.push(`关键词：${filters.keyword.trim()}`)
  }
  if (filters.role !== 'all') {
    items.push(`角色：${filters.role}`)
  }
  if (filters.status !== 'all') {
    items.push(`状态：${filters.status === 'active' ? '正常' : '封禁'}`)
  }

  return items.length ? items.join(' / ') : '全部用户'
})
const userTableColumns: TableColumn<UserInfo>[] = [
  { accessorKey: 'username', header: '用户' },
  { accessorKey: 'email', header: '邮箱' },
  { id: 'account', header: '账号状态' },
  { accessorKey: 'created_at', header: '创建时间' },
  { id: 'actions', header: '角色与状态调整' },
]

function getRoleLabel(role: UserRole) {
  return roleOptions.find(option => option.value === role)?.label || role
}

function getStatusLabel(status: UserStatus) {
  return statusOptions.find(option => option.value === status)?.label || status
}

function syncDrafts() {
  for (const user of users.value) {
    roleDrafts[user.id] = user.role
    statusDrafts[user.id] = user.status
  }
}

async function loadUsers() {
  loading.value = true
  try {
    users.value = await $fetch<UserInfo[]>('/api/admin/users')
    syncDrafts()
  }
  catch (e: any) {
    toast.add({ title: '用户列表加载失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function canEditUser(user: UserInfo) {
  if (!authState.user) {
    return false
  }

  if (authState.user.role !== 'super_admin' && user.role === 'super_admin') {
    return false
  }

  return true
}

function getRoleOptions(user: UserInfo) {
  if (user.id === currentUserId.value) {
    return roleOptions.filter(option => option.value === user.role)
  }

  if (currentUserRole.value === 'super_admin') {
    return roleOptions
  }

  return roleOptions.filter(option => option.value !== 'super_admin')
}

function getStatusOptions(user: UserInfo) {
  if (user.id === currentUserId.value) {
    return statusOptions.filter(option => option.value !== 'banned')
  }

  return statusOptions
}

function getEditRestrictionReason(user: UserInfo) {
  if (!authState.user) {
    return '当前未登录，不能修改该用户。'
  }

  if (authState.user.role !== 'super_admin' && user.role === 'super_admin') {
    return '当前账号权限不足，不能修改超级管理员。'
  }

  if (user.id === currentUserId.value) {
    return '当前账号不能修改自己的角色，也不能把自己改为封禁。'
  }

  return ''
}

function hasPendingChange(user: UserInfo) {
  return roleDrafts[user.id] !== user.role || statusDrafts[user.id] !== user.status
}

function openSaveConfirm(user: UserInfo) {
  const nextRole: UserRole = roleDrafts[user.id] ?? user.role
  const nextStatus: UserStatus = statusDrafts[user.id] ?? user.status

  if (user.id === currentUserId.value && nextStatus === 'banned') {
    statusDrafts[user.id] = user.status
    toast.add({ title: '无法保存', description: '当前登录账号不能把自己改为封禁。', color: 'warning' })
    return
  }

  if (user.id === currentUserId.value && nextRole !== user.role) {
    roleDrafts[user.id] = user.role
    toast.add({ title: '无法保存', description: '当前登录账号不能修改自己的角色。', color: 'warning' })
    return
  }

  if (currentUserRole.value !== 'super_admin' && nextRole === 'super_admin') {
    roleDrafts[user.id] = user.role
    toast.add({ title: '无法保存', description: '只有超级管理员可以授予超级管理员角色。', color: 'warning' })
    return
  }

  pendingSaveTarget.value = {
    user,
    nextRole,
    nextStatus,
  }
  saveConfirmModalOpen.value = true
}

const saveConfirmRows = computed(() => {
  const target = pendingSaveTarget.value
  if (!target) {
    return []
  }

  return [
    {
      label: '目标用户',
      value: `${target.user.username} (#${target.user.id})`,
    },
    {
      label: '角色调整',
      value: `${getRoleLabel(target.user.role)} -> ${getRoleLabel(target.nextRole)}`,
    },
    {
      label: '状态调整',
      value: `${getStatusLabel(target.user.status)} -> ${getStatusLabel(target.nextStatus)}`,
    },
  ]
})

const saveConfirmDescription = computed(() => {
  const target = pendingSaveTarget.value
  if (!target) {
    return ''
  }

  if (target.user.role !== target.nextRole && target.nextStatus === 'banned') {
    return '这次操作会同时调整角色并封禁该账号。请确认该用户不再承担当前比赛或平台管理职责。'
  }

  if (target.nextStatus === 'banned') {
    return '封禁后，该账号将不能继续正常登录平台。请确认这是当前需要的处理结果。'
  }

  if (target.user.role !== target.nextRole) {
    return '角色权限会立即按新设置生效。请确认当前账号边界与职责范围匹配。'
  }

  return '本次会更新该用户的账号状态。请在保存前再次确认调整结果。'
})

async function saveUser() {
  const target = pendingSaveTarget.value
  if (!target) {
    saveConfirmModalOpen.value = false
    return
  }

  savingUserId.value = target.user.id
  try {
    const updated = await $api('put', '/api/admin/users/{userId}', {
      params: {
        userId: target.user.id,
      },
      body: {
        role: target.nextRole,
        status: target.nextStatus,
      },
    })
    const normalized: UserInfo = {
      ...target.user,
      ...updated,
      role: updated.role || target.nextRole,
      status: updated.status || target.nextStatus,
    }

    const index = users.value.findIndex(item => item.id === target.user.id)
    if (index !== -1) {
      users.value[index] = normalized
      roleDrafts[normalized.id] = normalized.role
      statusDrafts[normalized.id] = normalized.status
    }

    toast.add({
      title: '用户已更新',
      description: `${normalized.username} 的账号状态已经保存。`,
      color: 'success',
    })
    saveConfirmModalOpen.value = false
    pendingSaveTarget.value = null
  }
  catch (e: any) {
    roleDrafts[target.user.id] = target.user.role
    statusDrafts[target.user.id] = target.user.status
    toast.add({ title: '保存失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    savingUserId.value = null
  }
}

onMounted(async () => {
  await ensureInitialized()
  await loadUsers()
})
</script>

<template>
  <div class="py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold">
        用户管理
      </h1>
      <p class="mt-1 text-muted">
        查看平台用户，并按需调整角色与账号状态。
      </p>
    </div>

    <UAlert
      class="mb-6"
      color="info"
      variant="soft"
      icon="i-lucide-shield-check"
      title="当前页仅处理基础账号权限"
      description="建议只在确有需要时调整管理员权限。当前登录账号不能在这里修改自己的角色，也不能把自己改为封禁。"
    />

    <UPageGrid :cols="{ default: 1, sm: 3 }" class="mb-6">
      <UPageCard title="总用户数" :description="String(totalUsers)" icon="i-lucide-users" />
      <UPageCard title="管理账号" :description="String(adminUsers)" icon="i-lucide-shield" />
      <UPageCard title="已封禁" :description="String(bannedUsers)" icon="i-lucide-user-round-x" />
    </UPageGrid>

    <UPageCard title="筛选" icon="i-lucide-filter" class="mb-6">
      <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px_auto] md:items-end">
        <UFormField label="关键词" name="user-keyword">
          <UInput v-model="filters.keyword" class="w-full" placeholder="搜索用户名、邮箱或 ID" />
        </UFormField>
        <UFormField label="角色" name="user-role">
          <USelect v-model="filters.role" :items="filterRoleOptions" class="w-full" />
        </UFormField>
        <UFormField label="状态" name="user-status">
          <USelect v-model="filters.status" :items="filterStatusOptions" class="w-full" />
        </UFormField>
        <div class="flex justify-end">
          <UButton
            variant="outline"
            icon="i-lucide-rotate-ccw"
            @click="filters.keyword = ''; filters.role = 'all'; filters.status = 'all'"
          >
            重置
          </UButton>
        </div>
      </div>
      <template #footer>
        <div class="text-sm text-muted">
          当前筛选：{{ activeFilterSummary }} · 命中 {{ filteredUsers.length }} / {{ totalUsers }}
        </div>
      </template>
    </UPageCard>

    <UPageCard title="账号列表" icon="i-lucide-list">
      <div v-if="loading" class="flex justify-center py-10">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
      </div>

      <UTable
        v-else-if="filteredUsers.length"
        :data="filteredUsers"
        :columns="userTableColumns"
        class="overflow-x-auto"
        :ui="{
          td: 'align-top',
        }"
      >
        <template #username-cell="{ row }">
          <div class="min-w-52">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium">{{ row.original.username }}</span>
              <UBadge v-if="row.original.id === currentUserId" color="primary" variant="subtle">
                当前账号
              </UBadge>
            </div>
            <div class="mt-1 text-xs text-muted">
              #{{ row.original.id }}
            </div>
          </div>
        </template>

        <template #email-cell="{ row }">
          <div class="min-w-56 break-all text-sm">
            {{ row.original.email }}
          </div>
        </template>

        <template #account-cell="{ row }">
          <div class="min-w-44 space-y-2">
            <div class="flex flex-wrap gap-2">
              <UBadge :color="row.original.status === 'active' ? 'success' : 'error'" variant="soft">
                {{ getStatusLabel(row.original.status) }}
              </UBadge>
              <UBadge :color="row.original.role === 'super_admin' ? 'warning' : row.original.role === 'admin' ? 'info' : 'neutral'" variant="subtle">
                {{ getRoleLabel(row.original.role) }}
              </UBadge>
            </div>
            <div class="text-xs text-muted">
              {{ hasPendingChange(row.original) ? '有未保存修改' : '当前状态已保存' }}
            </div>
          </div>
        </template>

        <template #created_at-cell="{ row }">
          <div class="min-w-40 text-sm text-muted">
            {{ row.original.created_at ? new Date(row.original.created_at).toLocaleString() : '-' }}
          </div>
        </template>

        <template #actions-cell="{ row }">
          <div class="min-w-[420px] space-y-3">
            <div class="grid gap-3 md:grid-cols-[160px_160px_auto] md:items-end">
              <UFormField label="角色" :name="`role-${row.original.id}`">
                <USelect
                  v-model="roleDrafts[row.original.id]"
                  :items="getRoleOptions(row.original)"
                  class="w-full"
                  :disabled="!canEditUser(row.original) || savingUserId === row.original.id"
                />
              </UFormField>

              <UFormField label="状态" :name="`status-${row.original.id}`">
                <USelect
                  v-model="statusDrafts[row.original.id]"
                  :items="getStatusOptions(row.original)"
                  class="w-full"
                  :disabled="!canEditUser(row.original) || savingUserId === row.original.id"
                />
              </UFormField>

              <UButton
                icon="i-lucide-save"
                :loading="savingUserId === row.original.id"
                :disabled="!canEditUser(row.original) || !hasPendingChange(row.original)"
                @click="openSaveConfirm(row.original)"
              >
                保存
              </UButton>
            </div>

            <div v-if="!canEditUser(row.original) || getEditRestrictionReason(row.original)" class="text-xs text-muted">
              {{ getEditRestrictionReason(row.original) || '当前账号权限不足，不能修改该用户。' }}
            </div>
          </div>
        </template>
      </UTable>

      <div v-else class="text-sm text-muted">
        当前筛选下没有匹配的用户记录。
      </div>
    </UPageCard>

    <UModal
      v-model:open="saveConfirmModalOpen"
      title="确认保存账号调整"
      :description="saveConfirmDescription"
      :dismissible="savingUserId === null"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <div class="space-y-4">
          <div class="rounded-lg border border-default px-3 py-3 text-sm">
            <div
              v-for="row in saveConfirmRows"
              :key="row.label"
              class="flex items-center justify-between gap-3 py-2"
            >
              <span class="text-muted">{{ row.label }}</span>
              <span class="text-right">{{ row.value }}</span>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="outline"
          :disabled="savingUserId !== null"
          @click="saveConfirmModalOpen = false; pendingSaveTarget = null"
        >
          取消
        </UButton>
        <UButton
          icon="i-lucide-save"
          :loading="savingUserId !== null"
          @click="saveUser()"
        >
          确认保存
        </UButton>
      </template>
    </UModal>
  </div>
</template>
