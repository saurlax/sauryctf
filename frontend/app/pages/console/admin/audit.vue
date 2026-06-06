<script setup lang="ts">
definePageMeta({
  middleware: 'admin',
})

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

const filters = reactive({
  targetType: 'all',
  limit: 50,
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

const totalLogs = computed(() => logs.value.length)
const uniqueActors = computed(() => new Set(logs.value.map(log => log.actor_user_id)).size)
const recent24hLogs = computed(() => {
  const since = Date.now() - 24 * 60 * 60 * 1000
  return logs.value.filter(log => new Date(log.created_at).getTime() >= since).length
})

function getActionLabel(action: string) {
  const labels: Record<string, string> = {
    'admin.user.update': '更新用户',
    'admin.game.create': '创建比赛',
    'admin.game.update': '更新比赛',
    'admin.game.delete': '删除比赛',
    'admin.game.attach_challenge': '挂载题目',
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

async function loadLogs() {
  loading.value = true
  try {
    logs.value = await $fetch<AuditLog[]>('/api/admin/audit-logs', {
      query: {
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

    <UPageGrid :cols="{ default: 1, sm: 3 }" class="mb-6">
      <UPageCard title="当前记录数" :description="String(totalLogs)" icon="i-lucide-scroll-text" />
      <UPageCard title="涉及管理员" :description="String(uniqueActors)" icon="i-lucide-users-round" />
      <UPageCard title="最近 24 小时" :description="String(recent24hLogs)" icon="i-lucide-clock-3" />
    </UPageGrid>

    <UPageCard title="筛选" icon="i-lucide-filter" class="mb-6">
      <div class="grid gap-3 md:grid-cols-[180px_140px_auto] md:items-end">
        <UFormField label="对象类型" name="target-type">
          <USelect v-model="filters.targetType" :items="targetTypeOptions" class="w-full" />
        </UFormField>
        <UFormField label="记录条数" name="limit">
          <USelect v-model="filters.limit" :items="limitOptions" class="w-full" />
        </UFormField>
        <div class="flex justify-end">
          <UButton icon="i-lucide-refresh-cw" :loading="loading" @click="loadLogs">
            刷新
          </UButton>
        </div>
      </div>
    </UPageCard>

    <UPageCard title="最近操作" icon="i-lucide-list">
      <div v-if="loading" class="flex justify-center py-10">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
      </div>

      <div v-else-if="logs.length" class="space-y-3">
        <div
          v-for="log in logs"
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
              <div v-if="log.detail" class="mt-2 rounded bg-elevated px-3 py-2 text-xs text-muted break-all">
                {{ log.detail }}
              </div>
            </div>
            <div class="text-xs text-muted">
              {{ new Date(log.created_at).toLocaleString() }}
            </div>
          </div>
        </div>
      </div>

      <div v-else class="text-sm text-muted">
        当前还没有可展示的管理操作记录。
      </div>
    </UPageCard>
  </div>
</template>
