<script setup lang="ts">
definePageMeta({
  middleware: 'admin',
})

const route = useRoute()
type AuditLog = {
  id: number
  actor_user_id: number
  actor_username: string
  action: string
  target_type: string
  target_id: number
  summary: string
  detail: string
  created_at: string
}

const toast = useToast()
const loading = ref(true)
const logs = ref<AuditLog[]>([])
const expandedLogIds = ref<number[]>([])

const filters = reactive({
  actorUserId: undefined as number | undefined,
  targetType: 'all',
  action: 'all',
  limit: 50,
  keyword: '',
})

const targetTypeOptions = [
  { label: '全部对象', value: 'all' },
  { label: '用户', value: 'user' },
  { label: '比赛', value: 'game' },
  { label: '题目', value: 'challenge' },
]

const limitOptions = [
  { label: '20 条', value: 20 },
  { label: '50 条', value: 50 },
  { label: '100 条', value: 100 },
]

const actionOptions = [
  { label: '全部动作', value: 'all' },
  { label: '更新用户', value: 'admin.user.update' },
  { label: '创建比赛', value: 'admin.game.create' },
  { label: '更新比赛', value: 'admin.game.update' },
  { label: '删除比赛', value: 'admin.game.delete' },
  { label: '导入比赛包', value: 'admin.game.import' },
  { label: '导出比赛包', value: 'admin.game.export' },
  { label: '导出榜单', value: 'admin.game.export_scoreboard' },
  { label: '导出 Writeup', value: 'admin.game.export_writeups' },
  { label: '导出提交记录', value: 'admin.game.export_submissions' },
  { label: '发布公告', value: 'admin.game.create_announcement' },
  { label: '删除公告', value: 'admin.game.delete_announcement' },
  { label: '挂载题目', value: 'admin.game.attach_challenge' },
  { label: '移除比赛题目', value: 'admin.game.remove_challenge' },
  { label: '更新报名状态', value: 'admin.game.update_participation' },
  { label: '移除报名', value: 'admin.game.remove_participation' },
  { label: '审核 Writeup', value: 'admin.game.review_writeup' },
  { label: '销毁实例租约', value: 'admin.game.destroy_instance_lease' },
  { label: '创建题目', value: 'admin.challenge.create' },
  { label: '更新题目', value: 'admin.challenge.update' },
  { label: '删除题目', value: 'admin.challenge.delete' },
]

const totalLogs = computed(() => logs.value.length)
const uniqueActors = computed(() => new Set(logs.value.map(log => log.actor_user_id)).size)
const recent24hLogs = computed(() => {
  const since = Date.now() - 24 * 60 * 60 * 1000
  return logs.value.filter(log => new Date(log.created_at).getTime() >= since).length
})
const filteredLogs = computed(() => {
  const keyword = filters.keyword.trim().toLowerCase()

  return logs.value.filter((log) => {
    if (filters.action !== 'all' && log.action !== filters.action) {
      return false
    }

    if (!keyword) {
      return true
    }

    return [
      log.summary,
      log.detail,
      log.actor_username,
      log.action,
      log.target_type,
      String(log.target_id),
      String(log.actor_user_id),
    ].some(value => value?.toLowerCase().includes(keyword))
  })
})
const activeFilterSummary = computed(() => {
  const items: string[] = []

  if (filters.keyword.trim()) {
    items.push(`关键词：${filters.keyword.trim()}`)
  }

  if (filters.actorUserId) {
    items.push(`操作者 #${filters.actorUserId}`)
  }

  if (filters.targetType !== 'all') {
    items.push(getTargetTypeLabel(filters.targetType))
  }

  if (filters.action !== 'all') {
    items.push(getActionLabel(filters.action))
  }

  items.push(`最近 ${filters.limit} 条`)
  return items.join(' / ')
})
const expandedLogSet = computed(() => new Set(expandedLogIds.value))
const highlightUserId = computed(() => {
  const raw = route.query.highlight_user_id
  const value = typeof raw === 'string' ? Number(raw) : Number(Array.isArray(raw) ? raw[0] : NaN)
  return Number.isFinite(value) ? value : null
})
const logActionTargets = computed<Record<number, { label: string, to: string } | null>>(() =>
  Object.fromEntries(filteredLogs.value.map(log => [log.id, resolveLogTarget(log)])),
)

function getActionLabel(action: string) {
  const labels: Record<string, string> = {
    'admin.user.update': '更新用户',
    'admin.game.create': '创建比赛',
    'admin.game.update': '更新比赛',
    'admin.game.delete': '删除比赛',
    'admin.game.import': '导入比赛包',
    'admin.game.export': '导出比赛包',
    'admin.game.export_scoreboard': '导出榜单',
    'admin.game.export_writeups': '导出 Writeup',
    'admin.game.export_submissions': '导出提交记录',
    'admin.game.create_announcement': '发布公告',
    'admin.game.delete_announcement': '删除公告',
    'admin.game.attach_challenge': '挂载题目',
    'admin.game.remove_challenge': '移除比赛题目',
    'admin.game.update_participation': '更新报名状态',
    'admin.game.remove_participation': '移除报名',
    'admin.game.review_writeup': '审核 Writeup',
    'admin.game.destroy_instance_lease': '销毁实例租约',
    'admin.challenge.create': '创建题目',
    'admin.challenge.update': '更新题目',
    'admin.challenge.delete': '删除题目',
  }

  return labels[action] || action
}

function getTargetTypeLabel(targetType: string) {
  const labels: Record<string, string> = {
    user: '用户',
    game: '比赛',
    challenge: '题目',
  }

  return labels[targetType] || targetType
}

function resolveLogTarget(log: AuditLog) {
  if (log.target_type === 'user') {
    return {
      label: '去用户管理',
      to: `/console/admin/users?highlight_user_id=${log.target_id}`,
    }
  }

  if (log.target_type === 'game') {
    const section = (() => {
      if (log.action.includes('writeup')) {
        return '#writeups'
      }
      if (log.action.includes('announcement')) {
        return '#announcements'
      }
      if (log.action.includes('participation')) {
        return '#participants'
      }
      if (log.action.includes('attach_challenge') || log.action.includes('remove_challenge')) {
        return '#attach-challenge'
      }
      return '#game-settings'
    })()

    const mode = log.action === 'admin.game.update' ? '&mode=edit-game' : ''
    return {
      label: '去比赛管理',
      to: `/console/admin?game_id=${log.target_id}&section=${encodeURIComponent(section)}${mode}`,
    }
  }

  if (log.target_type === 'challenge') {
    return {
      label: '去题目维护',
      to: `/console/admin?challenge_id=${log.target_id}&section=${encodeURIComponent('#create-challenge')}&mode=edit-challenge`,
    }
  }

  return null
}

async function loadLogs() {
  loading.value = true
  try {
    logs.value = await $fetch<AuditLog[]>('/api/admin/audit-logs', {
      query: {
        actor_user_id: filters.actorUserId || undefined,
        target_type: filters.targetType === 'all' ? undefined : filters.targetType,
        limit: filters.limit,
      },
    })
  }
  catch (e: any) {
    toast.add({ title: '审计日志加载失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function toggleLogExpanded(logId: number) {
  if (expandedLogSet.value.has(logId)) {
    expandedLogIds.value = expandedLogIds.value.filter(id => id !== logId)
    return
  }

  expandedLogIds.value = [...expandedLogIds.value, logId]
}

onMounted(loadLogs)
</script>

<template>
  <div class="py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold">
        审计日志
      </h1>
      <p class="mt-1 text-muted">
        查看最近的管理操作记录，便于复盘账号、比赛与题目配置变更。
      </p>
    </div>

    <div v-if="highlightUserId" class="mb-4 rounded-lg border border-default px-3 py-3 text-sm text-muted leading-6">
      当前从用户对象上下文进入，目标用户：#{{ highlightUserId }}。
    </div>

    <UPageGrid :cols="{ default: 1, sm: 3 }" class="mb-6">
      <UPageCard title="当前记录数" :description="String(totalLogs)" icon="i-lucide-scroll-text" />
      <UPageCard title="涉及管理员" :description="String(uniqueActors)" icon="i-lucide-users-round" />
      <UPageCard title="最近 24 小时" :description="String(recent24hLogs)" icon="i-lucide-clock-3" />
    </UPageGrid>

    <UPageCard title="筛选" icon="i-lucide-filter" class="mb-6">
      <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_180px_200px_140px_auto] md:items-end">
        <UFormField label="关键词" name="audit-keyword">
          <UInput v-model="filters.keyword" class="w-full" placeholder="搜索摘要、详情、操作者或对象 ID" />
        </UFormField>
        <UFormField label="操作者 ID" name="actor-user-id">
          <UInputNumber v-model="filters.actorUserId" :min="1" orientation="vertical" class="w-full" placeholder="例如：1" />
        </UFormField>
        <UFormField label="对象类型" name="target-type">
          <USelect v-model="filters.targetType" :items="targetTypeOptions" class="w-full" />
        </UFormField>
        <UFormField label="动作类型" name="action-type">
          <USelect v-model="filters.action" :items="actionOptions" class="w-full" />
        </UFormField>
        <UFormField label="记录条数" name="limit">
          <USelect v-model="filters.limit" :items="limitOptions" class="w-full" />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton
            variant="outline"
            icon="i-lucide-rotate-ccw"
            @click="filters.keyword = ''; filters.actorUserId = undefined; filters.targetType = 'all'; filters.action = 'all'; filters.limit = 50"
          >
            重置
          </UButton>
          <UButton icon="i-lucide-refresh-cw" :loading="loading" @click="loadLogs">
            刷新
          </UButton>
        </div>
      </div>
      <template #footer>
        <div class="text-sm text-muted">
          当前筛选：{{ activeFilterSummary }}
        </div>
      </template>
    </UPageCard>

    <UPageCard title="最近操作" icon="i-lucide-list">
      <div v-if="loading" class="flex justify-center py-10">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
      </div>

      <div v-else-if="filteredLogs.length" class="space-y-3">
        <div
          v-for="log in filteredLogs"
          :key="log.id"
          class="rounded-lg border border-default px-4 py-4"
        >
          <div class="flex items-start justify-between gap-3 flex-wrap">
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium">{{ log.summary }}</span>
                <UBadge color="info" variant="soft">
                  {{ getActionLabel(log.action) }}
                </UBadge>
                <UBadge color="neutral" variant="subtle">
                  {{ getTargetTypeLabel(log.target_type) }} #{{ log.target_id }}
                </UBadge>
              </div>
              <div class="mt-2 text-sm text-muted">
                操作者：{{ log.actor_username }} (#{{ log.actor_user_id }})
              </div>
              <div v-if="logActionTargets[log.id]" class="mt-3">
                <UButton
                  size="xs"
                  variant="outline"
                  icon="i-lucide-arrow-up-right"
                  :to="logActionTargets[log.id]!.to"
                >
                  {{ logActionTargets[log.id]!.label }}
                </UButton>
              </div>
              <div v-if="log.detail" class="mt-3">
                <UButton
                  size="xs"
                  variant="ghost"
                  :icon="expandedLogSet.has(log.id) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                  @click="toggleLogExpanded(log.id)"
                >
                  {{ expandedLogSet.has(log.id) ? '收起详情' : '展开详情' }}
                </UButton>
                <div
                  v-if="expandedLogSet.has(log.id)"
                  class="mt-2 rounded bg-elevated px-3 py-2 text-xs text-muted break-all"
                >
                  {{ log.detail }}
                </div>
              </div>
            </div>
            <div class="text-xs text-muted">
              {{ new Date(log.created_at).toLocaleString() }}
            </div>
          </div>
        </div>
      </div>

      <div v-else class="text-sm text-muted">
        当前筛选下没有可展示的管理操作记录。
      </div>
    </UPageCard>
  </div>
</template>
