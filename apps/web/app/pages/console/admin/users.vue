<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type {
  AdminUserListRequest,
  AdminUserListResponse,
  ChangeGlobalRoleRequest,
  ChangeUserStatusRequest,
  GlobalRole,
  GlobalRoleChanged,
  ManagedIdentity,
  ManagedUserStatus,
  UserStatusChanged,
} from '~~/shared/contracts/identity'

definePageMeta({ middleware: 'admin' })

const { authState, ensureInitialized } = useAuth()
const route = useRoute()
const toast = useToast()
await ensureInitialized()

const users = ref<ManagedIdentity[]>([])
const loading = ref(true)
const saving = ref(false)
const confirmOpen = ref(false)
const pending = ref<ManagedIdentity | null>(null)
const managementReason = ref('')
const keyword = ref('')
const roleDrafts = reactive<Record<string, GlobalRole>>({})
const statusDrafts = reactive<Record<string, ManagedUserStatus>>({})

const roleOptions = [
  { label: '普通用户', value: 'user' },
  { label: '主办方', value: 'organizer' },
  { label: '管理员', value: 'admin' },
]
const statusOptions = [
  { label: '正常', value: 'active' },
  { label: '封禁', value: 'banned' },
]
const columns: TableColumn<ManagedIdentity>[] = [
  { accessorKey: 'username', header: '用户' },
  { accessorKey: 'email', header: '邮箱' },
  { id: 'verification', header: '验证' },
  { id: 'management', header: '角色与状态' },
]

const highlightedUserId = computed(() => {
  const value = Array.isArray(route.query.highlight_user_id)
    ? route.query.highlight_user_id[0]
    : route.query.highlight_user_id
  return typeof value === 'string' && value.length > 0 ? value : null
})
const filteredUsers = computed(() => {
  const search = keyword.value.trim().toLocaleLowerCase()
  if (!search) return users.value
  return users.value.filter(user => [user.id, user.username, user.email]
    .some(value => value.toLocaleLowerCase().includes(search)))
})
const summary = computed(() => ({
  total: users.value.length,
  privileged: users.value.filter(user => user.role !== 'user').length,
  banned: users.value.filter(user => user.status === 'banned').length,
}))
const normalizedManagementReason = computed(() => managementReason.value.normalize('NFKC').trim())

function syncDrafts() {
  for (const user of users.value) {
    roleDrafts[user.id] = user.role
    statusDrafts[user.id] = user.status
  }
}

async function loadUsers() {
  loading.value = true
  try {
    const items: ManagedIdentity[] = []
    let cursor: string | undefined
    do {
      const response = await $controlApi<AdminUserListResponse, never, AdminUserListRequest>('get', '/api/admin/users', {
        query: { cursor, limit: 100 },
      })
      items.push(...response.items)
      cursor = response.page.next_cursor ?? undefined
    } while (cursor)
    users.value = items
    syncDrafts()
    if (highlightedUserId.value) {
      keyword.value = highlightedUserId.value
      await nextTick()
      document.getElementById(`user-row-${highlightedUserId.value}`)?.scrollIntoView({ block: 'center' })
    }
  }
  catch (error) {
    toast.add({ title: '用户列表加载失败', description: controlPlaneErrorMessage(error), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function hasChange(user: ManagedIdentity) {
  return roleDrafts[user.id] !== user.role || statusDrafts[user.id] !== user.status
}

function openConfirm(user: ManagedIdentity) {
  if (user.id === authState.user?.id) {
    toast.add({ title: '不能修改当前账号', color: 'warning' })
    syncDrafts()
    return
  }
  managementReason.value = ''
  pending.value = user
  confirmOpen.value = true
}

function resetConfirmation() {
  pending.value = null
  managementReason.value = ''
}

async function saveUser() {
  const user = pending.value
  const reason = normalizedManagementReason.value
  if (!user || reason.length < 3) return
  saving.value = true
  try {
    const nextRole = roleDrafts[user.id] ?? user.role
    const nextStatus = statusDrafts[user.id] ?? user.status
    let sessionVersion = user.session_version
    if (nextRole !== user.role) {
      const result = await $controlApi<GlobalRoleChanged, ChangeGlobalRoleRequest>('patch', '/api/admin/users/{userId}/role', {
        params: { userId: user.id },
        body: { role: nextRole, reason },
      })
      sessionVersion = result.session_version
    }
    if (nextStatus !== user.status) {
      const result = await $controlApi<UserStatusChanged, ChangeUserStatusRequest>('patch', '/api/admin/users/{userId}/status', {
        params: { userId: user.id },
        body: { status: nextStatus, reason },
      })
      sessionVersion = result.session_version
    }
    Object.assign(user, { role: nextRole, status: nextStatus, session_version: sessionVersion })
    confirmOpen.value = false
    resetConfirmation()
    toast.add({ title: '用户权限已更新', description: '目标用户的旧登录状态已失效。', color: 'success' })
  }
  catch (error) {
    await loadUsers()
    toast.add({ title: '保存失败', description: controlPlaneErrorMessage(error), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

watch(confirmOpen, (open) => {
  if (!open && !saving.value) resetConfirmation()
})

onMounted(loadUsers)
</script>

<template>
  <div class="py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold">用户管理</h1>
      <p class="mt-1 text-muted">维护全局角色与账号状态；变更会立即撤销目标用户的旧登录状态。</p>
    </div>

    <UPageGrid :cols="{ default: 1, sm: 3 }" class="mb-6">
      <UPageCard title="用户" :description="String(summary.total)" icon="i-lucide-users" />
      <UPageCard title="主办与管理账号" :description="String(summary.privileged)" icon="i-lucide-shield" />
      <UPageCard title="已封禁" :description="String(summary.banned)" icon="i-lucide-user-round-x" />
    </UPageGrid>

    <UPageCard title="账号列表" icon="i-lucide-list">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <UInput v-model="keyword" icon="i-lucide-search" placeholder="搜索用户名、邮箱或 UUID" class="w-full max-w-md" />
        <UButton variant="outline" icon="i-lucide-refresh-cw" :loading="loading" @click="loadUsers">刷新</UButton>
      </div>

      <div v-if="loading" class="flex justify-center py-10"><UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" /></div>
      <UTable v-else-if="filteredUsers.length" :data="filteredUsers" :columns="columns" class="overflow-x-auto">
        <template #username-cell="{ row }">
          <div :id="`user-row-${row.original.id}`" class="min-w-56" :class="highlightedUserId === row.original.id ? 'rounded-md bg-primary/5 p-2 ring-1 ring-primary/30' : ''">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{{ row.original.username }}</span>
              <UBadge v-if="row.original.id === authState.user?.id" color="primary" variant="soft">当前账号</UBadge>
            </div>
            <div class="mt-1 break-all text-xs text-muted">{{ row.original.id }}</div>
          </div>
        </template>
        <template #email-cell="{ row }"><div class="min-w-56 break-all">{{ row.original.email }}</div></template>
        <template #verification-cell="{ row }">
          <UBadge :color="row.original.email_verified ? 'success' : 'warning'" variant="soft">{{ row.original.email_verified ? '已验证' : '待验证' }}</UBadge>
        </template>
        <template #management-cell="{ row }">
          <div class="grid min-w-[430px] gap-3 md:grid-cols-[150px_150px_auto] md:items-end">
            <UFormField label="全局角色"><USelect v-model="roleDrafts[row.original.id]" :items="roleOptions" :disabled="row.original.id === authState.user?.id || saving" /></UFormField>
            <UFormField label="账号状态"><USelect v-model="statusDrafts[row.original.id]" :items="statusOptions" :disabled="row.original.id === authState.user?.id || saving" /></UFormField>
            <UButton icon="i-lucide-save" :disabled="row.original.id === authState.user?.id || !hasChange(row.original) || saving" @click="openConfirm(row.original)">保存</UButton>
          </div>
        </template>
      </UTable>
      <div v-else class="py-8 text-center text-sm text-muted">没有匹配的用户。</div>
    </UPageCard>

    <UModal v-model:open="confirmOpen" title="确认账号调整" description="角色或状态变化会递增 Session 版本，使目标账号的全部旧 Cookie 失效。" :dismissible="!saving" :ui="{ footer: 'justify-end' }">
      <template #body>
        <div v-if="pending" class="space-y-4">
          <div class="space-y-2 rounded-lg border border-default p-4 text-sm">
            <div class="flex justify-between gap-4"><span class="text-muted">用户</span><span>{{ pending.username }}</span></div>
            <div class="flex justify-between gap-4"><span class="text-muted">角色</span><span>{{ pending.role }} → {{ roleDrafts[pending.id] }}</span></div>
            <div class="flex justify-between gap-4"><span class="text-muted">状态</span><span>{{ pending.status }} → {{ statusDrafts[pending.id] }}</span></div>
          </div>
          <UFormField label="变更原因" description="原因将写入不可变审计记录。" required>
            <UTextarea v-model="managementReason" :rows="3" :maxlength="1000" placeholder="说明本次角色或状态调整的依据" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" :disabled="saving" @click="() => { confirmOpen = false }">取消</UButton>
        <UButton :loading="saving" :disabled="normalizedManagementReason.length < 3" @click="saveUser">确认保存</UButton>
      </template>
    </UModal>
  </div>
</template>
