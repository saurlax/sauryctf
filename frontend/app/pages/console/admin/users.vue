<script setup lang="ts">
definePageMeta({
  middleware: 'admin',
})

import type { components } from '~/types/api'

type UserInfo = components['schemas']['UserInfo']
type UserRole = NonNullable<UserInfo['role']>
type UserStatus = NonNullable<UserInfo['status']>

const { authState, ensureInitialized } = useAuth()
const toast = useToast()

const loading = ref(true)
const savingUserId = ref<number | null>(null)
const users = ref<UserInfo[]>([])

const roleDrafts = reactive<Record<number, UserRole>>({})
const statusDrafts = reactive<Record<number, UserStatus>>({})

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

function hasPendingChange(user: UserInfo) {
  return roleDrafts[user.id] !== user.role || statusDrafts[user.id] !== user.status
}

async function saveUser(user: UserInfo) {
  savingUserId.value = user.id
  try {
    const nextRole: UserRole = roleDrafts[user.id] ?? user.role
    const nextStatus: UserStatus = statusDrafts[user.id] ?? user.status
    const updated = await $api('put', '/api/admin/users/{userId}', {
      params: {
        userId: user.id,
      },
      body: {
        role: nextRole,
        status: nextStatus,
      },
    })
    const normalized: UserInfo = {
      ...user,
      ...updated,
      role: updated.role || nextRole,
      status: updated.status || nextStatus,
    }

    const index = users.value.findIndex(item => item.id === user.id)
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
  }
  catch (e: any) {
    roleDrafts[user.id] = user.role
    statusDrafts[user.id] = user.status
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
      description="建议只在确有需要时调整管理员权限。当前登录账号不能在这里把自己改为封禁。"
    />

    <UPageGrid :cols="{ default: 1, sm: 3 }" class="mb-6">
      <UPageCard title="总用户数" :description="String(totalUsers)" icon="i-lucide-users" />
      <UPageCard title="管理账号" :description="String(adminUsers)" icon="i-lucide-shield" />
      <UPageCard title="已封禁" :description="String(bannedUsers)" icon="i-lucide-user-round-x" />
    </UPageGrid>

    <UPageCard title="账号列表" icon="i-lucide-list">
      <div v-if="loading" class="flex justify-center py-10">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
      </div>

      <div v-else-if="users.length" class="space-y-3">
        <div
          v-for="user in users"
          :key="user.id"
          class="rounded-lg border border-default px-4 py-4"
        >
          <div class="flex items-start justify-between gap-3 flex-wrap">
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium">{{ user.username }}</span>
                <UBadge :color="user.status === 'active' ? 'success' : 'error'" variant="soft">
                  {{ user.status === 'active' ? '正常' : '封禁' }}
                </UBadge>
                <UBadge :color="user.role === 'super_admin' ? 'warning' : user.role === 'admin' ? 'info' : 'neutral'" variant="subtle">
                  {{ user.role }}
                </UBadge>
                <UBadge v-if="user.id === currentUserId" color="primary" variant="subtle">
                  当前账号
                </UBadge>
              </div>
              <div class="mt-2 text-sm text-muted">
                #{{ user.id }} · {{ user.email }}
              </div>
              <div v-if="user.created_at" class="mt-1 text-xs text-muted">
                创建时间：{{ new Date(user.created_at).toLocaleString() }}
              </div>
            </div>

            <div class="grid gap-3 md:grid-cols-[180px_180px_auto] md:items-end">
              <UFormField label="角色" :name="`role-${user.id}`">
                <USelect
                  v-model="roleDrafts[user.id]"
                  :items="roleOptions"
                  class="w-full"
                  :disabled="!canEditUser(user) || savingUserId === user.id"
                />
              </UFormField>

              <UFormField label="状态" :name="`status-${user.id}`">
                <USelect
                  v-model="statusDrafts[user.id]"
                  :items="statusOptions"
                  class="w-full"
                  :disabled="!canEditUser(user) || savingUserId === user.id"
                />
              </UFormField>

              <UButton
                icon="i-lucide-save"
                :loading="savingUserId === user.id"
                :disabled="!canEditUser(user) || !hasPendingChange(user)"
                @click="saveUser(user)"
              >
                保存
              </UButton>
            </div>
          </div>

          <div v-if="!canEditUser(user)" class="mt-3 text-xs text-muted">
            当前账号权限不足，不能修改该用户。
          </div>
        </div>
      </div>

      <div v-else class="text-sm text-muted">
        当前还没有可管理的用户记录。
      </div>
    </UPageCard>
  </div>
</template>
