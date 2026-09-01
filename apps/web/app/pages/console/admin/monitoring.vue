<script setup lang="ts">
import type { ControlPlaneResponse } from '~/utils/control-plane-api'

definePageMeta({ middleware: 'admin' })

type Snapshot = ControlPlaneResponse<'/api/admin/monitoring', 'get'>

const toast = useToast()
const route = useRoute()
const loading = ref(false)
const snapshot = ref<Snapshot | null>(null)
const kindOptions = [
  { label: '提交', value: 'submissions' },
  { label: '反作弊线索', value: 'cheat_clues' },
  { label: '实例', value: 'instances' },
  { label: '实例任务', value: 'instance_jobs' },
  { label: '公告', value: 'announcements' },
  { label: '站内通知', value: 'notifications' },
  { label: '邮件投递', value: 'mail_deliveries' },
  { label: 'Writeup', value: 'writeups' },
  { label: '审计', value: 'audit_events' },
] as const
type MonitoringKind = typeof kindOptions[number]['value']

const requestedKind = typeof route.query.kind === 'string' ? route.query.kind : ''
const activeKind = ref<MonitoringKind>(kindOptions.some(item => item.value === requestedKind)
  ? requestedKind as MonitoringKind
  : 'instances')
const filters = reactive({
  contestId: typeof route.query.contest_id === 'string' ? route.query.contest_id : '',
  challengeId: typeof route.query.challenge_id === 'string' ? route.query.challenge_id : '',
  teamId: typeof route.query.team_id === 'string' ? route.query.team_id : '',
  status: typeof route.query.status === 'string' ? route.query.status : '',
  limit: 50,
})

async function loadMonitoring(kind: MonitoringKind = activeKind.value) {
  loading.value = true
  try {
    snapshot.value = await $controlApi('get', '/api/admin/monitoring', {
      query: {
        kind,
        contest_id: filters.contestId.trim() || undefined,
        challenge_id: filters.challengeId.trim() || undefined,
        team_id: filters.teamId.trim() || undefined,
        status: filters.status.trim() || undefined,
        limit: filters.limit,
      },
    })
  }
  catch (error) {
    toast.add({ title: '监控数据加载失败', description: controlPlaneErrorMessage(error), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function resetFilters() {
  filters.contestId = ''
  filters.challengeId = ''
  filters.teamId = ''
  filters.status = ''
  void loadMonitoring()
}

function formatTime(value: string | null) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '无'
}

function detailEntries(details: Record<string, string | number | boolean | null>) {
  return Object.entries(details).filter(([, value]) => value !== null && value !== '')
}

watch(activeKind, kind => void loadMonitoring(kind))
onMounted(() => void loadMonitoring())
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <UPageHeader
      title="平台监控"
      description="查看 PostgreSQL 权威事实、缓存观测时间与 Worker 最后观察时间。"
    >
      <template #links>
        <UButton label="比赛管理" to="/console/admin" variant="outline" icon="i-lucide-settings-2" />
        <UButton label="审计日志" to="/console/admin/audit" variant="outline" icon="i-lucide-scroll-text" />
      </template>
    </UPageHeader>

    <UPageCard title="筛选条件" icon="i-lucide-list-filter">
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <UFormField label="比赛 ID"><UInput v-model="filters.contestId" placeholder="UUID" class="w-full" /></UFormField>
        <UFormField label="题目 ID"><UInput v-model="filters.challengeId" placeholder="UUID" class="w-full" /></UFormField>
        <UFormField label="队伍 ID"><UInput v-model="filters.teamId" placeholder="UUID" class="w-full" /></UFormField>
        <UFormField label="状态"><UInput v-model="filters.status" placeholder="如 dead / running" class="w-full" /></UFormField>
        <UFormField label="数量">
          <USelect v-model="filters.limit" :items="[20, 50, 100]" class="w-full" />
        </UFormField>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <UButton label="应用筛选" icon="i-lucide-search" :loading="loading" @click="loadMonitoring()" />
        <UButton label="清空" variant="outline" icon="i-lucide-rotate-ccw" @click="resetFilters" />
      </div>
    </UPageCard>

    <UPageCard title="运行事实" icon="i-lucide-activity">
      <UTabs v-model="activeKind" :items="[...kindOptions]" class="mb-5" />

      <div v-if="snapshot" class="mb-4 grid gap-3 md:grid-cols-3">
        <div class="rounded-lg border border-default px-3 py-3">
          <div class="text-xs text-muted">权威来源</div>
          <div class="mt-1 font-medium">PostgreSQL</div>
          <div class="mt-1 text-xs text-muted">生成于 {{ formatTime(snapshot.generated_at) }}</div>
        </div>
        <div class="rounded-lg border border-default px-3 py-3">
          <div class="text-xs text-muted">缓存观测</div>
          <div class="mt-1 font-medium">{{ snapshot.cache_observed_at ? formatTime(snapshot.cache_observed_at) : '当前视图未使用缓存' }}</div>
        </div>
        <div class="rounded-lg border border-default px-3 py-3">
          <div class="text-xs text-muted">Worker 陈旧阈值</div>
          <div class="mt-1 font-medium">{{ snapshot.worker_stale_after_seconds }} 秒</div>
        </div>
      </div>

      <div v-if="loading" class="py-10 text-center text-muted">正在读取监控事实...</div>
      <div v-else-if="snapshot?.items.length" class="space-y-3">
        <div v-for="item in snapshot.items" :key="item.id" class="rounded-lg border border-default px-4 py-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium break-all">{{ item.id }}</span>
                <UBadge :label="item.status" variant="subtle" />
                <UBadge v-if="item.worker_observation_stale" label="Worker 观察已陈旧" color="warning" variant="subtle" />
              </div>
              <div class="mt-1 text-xs text-muted">数据库事实时间：{{ formatTime(item.fact_at) }}</div>
              <div v-if="item.kind === 'instances' || item.kind === 'instance_jobs'" class="mt-1 text-xs text-muted">
                Worker 最后观察：{{ formatTime(item.worker_observed_at) }}
              </div>
            </div>
            <div class="text-xs text-muted text-right">
              <div v-if="item.contest_id">比赛 {{ item.contest_id }}</div>
              <div v-if="item.challenge_id">题目 {{ item.challenge_id }}</div>
              <div v-if="item.team_id">队伍 {{ item.team_id }}</div>
            </div>
          </div>
          <div v-if="detailEntries(item.details).length" class="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            <div v-for="[key, value] in detailEntries(item.details)" :key="key" class="rounded-md bg-elevated px-3 py-2 text-sm">
              <span class="text-muted">{{ key }}：</span><span class="break-all">{{ value }}</span>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="py-10 text-center text-muted">当前筛选条件下没有记录。</div>
    </UPageCard>
  </UContainer>
</template>
