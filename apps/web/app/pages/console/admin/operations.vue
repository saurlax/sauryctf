<script setup lang="ts">
import type { ControlPlaneResponse } from '~/utils/control-plane-api'

definePageMeta({ middleware: 'admin' })

type OperationResponse = ControlPlaneResponse<'/api/admin/operations', 'post'>
type OperationKind = OperationResponse['command']['kind']

const operationOptions = [
  { value: 'cache_rebuild', label: '缓存重建', target: '比赛 ID', description: '清理指定比赛的排行榜缓存，并从 PostgreSQL 持久快照重新生成公开投影。' },
  { value: 'dead_letter_replay', label: '死信重放', target: '实例任务 ID', description: '为已修复的 dead 任务增加一次尝试额度，保留既有任务尝试历史。' },
  { value: 'instance_reconcile', label: '实例对账', target: '实例 ID', description: '按当前期望代次创建或重新排队 reconcile 任务，不直接操作运行时资源。' },
  { value: 'session_invalidate', label: 'Session 版本失效', target: '用户 ID', description: '递增目标用户的 session_version，使全部旧 sealed Cookie 失效。' },
  { value: 'result_recalculate', label: '比赛结果重算', target: '比赛 ID', description: '删除可重建排行榜快照，并从正式比赛事实重新计算内部与公开投影。' },
] as const satisfies ReadonlyArray<{
  value: OperationKind
  label: string
  target: string
  description: string
}>

const route = useRoute()
const toast = useToast()
const modalOpen = ref(false)
const submitting = ref(false)
const latest = ref<OperationResponse['command'] | null>(null)
const idempotencyKey = ref('')
const lastAttemptSignature = ref('')
const requestedKind = typeof route.query.kind === 'string' ? route.query.kind : ''
const draft = reactive({
  kind: (operationOptions.some(item => item.value === requestedKind) ? requestedKind : 'cache_rebuild') as OperationKind,
  targetId: typeof route.query.target_id === 'string' ? route.query.target_id : '',
  reason: '',
})

const selected = computed(() => operationOptions.find(item => item.value === draft.kind) ?? operationOptions[0])
const canSubmit = computed(() => draft.targetId.trim().length > 0 && draft.reason.trim().length >= 10)

function openOperation(kind?: OperationKind) {
  if (kind) draft.kind = kind
  draft.reason = ''
  modalOpen.value = true
}

function resetDraft() {
  draft.reason = ''
  idempotencyKey.value = ''
  lastAttemptSignature.value = ''
}

async function executeOperation() {
  if (!canSubmit.value) return
  const signature = JSON.stringify({
    kind: draft.kind,
    target_id: draft.targetId.trim(),
    reason: draft.reason.trim(),
  })
  if (!idempotencyKey.value || lastAttemptSignature.value !== signature) {
    idempotencyKey.value = `admin-operation-${crypto.randomUUID()}`
    lastAttemptSignature.value = signature
  }
  submitting.value = true
  try {
    const result = await $controlApi('post', '/api/admin/operations', {
      headers: { 'Idempotency-Key': idempotencyKey.value },
      body: {
        kind: draft.kind,
        target_id: draft.targetId.trim(),
        reason: draft.reason.trim(),
        confirmed: true,
      },
    })
    latest.value = result.command
    modalOpen.value = false
    resetDraft()
    toast.add({ title: '运维命令已完成', description: `${selected.value.label}已写入不可变审计。`, color: 'success' })
  }
  catch (error) {
    toast.add({ title: '运维命令失败', description: controlPlaneErrorMessage(error), color: 'error' })
  }
  finally {
    submitting.value = false
  }
}

function resultEntries(result: Record<string, string | number | boolean | null>) {
  return Object.entries(result).filter(([, value]) => value !== null)
}

watch(modalOpen, (open) => {
  if (!open && !submitting.value) resetDraft()
})

onMounted(() => {
  if (draft.targetId) modalOpen.value = true
})
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <UPageHeader title="运维操作" description="通过带原因、确认、幂等键和不可变审计的命令修复派生状态。">
      <template #links>
        <UButton label="平台监控" to="/console/admin/monitoring" variant="outline" icon="i-lucide-activity" />
        <UButton label="审计日志" to="/console/admin/audit" variant="outline" icon="i-lucide-scroll-text" />
      </template>
    </UPageHeader>

    <UPageGrid :cols="{ default: 1, md: 2 }">
      <UPageCard
        v-for="operation in operationOptions"
        :key="operation.value"
        :title="operation.label"
        :description="operation.description"
        icon="i-lucide-wrench"
      >
        <template #footer>
          <UButton label="执行命令" variant="outline" icon="i-lucide-play" @click="openOperation(operation.value)" />
        </template>
      </UPageCard>
    </UPageGrid>

    <UPageCard v-if="latest" title="最近完成" icon="i-lucide-circle-check-big">
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-lg border border-default px-3 py-3">
          <div class="text-xs text-muted">命令</div>
          <div class="mt-1 font-medium">{{ operationOptions.find(item => item.value === latest?.kind)?.label }}</div>
        </div>
        <div class="rounded-lg border border-default px-3 py-3">
          <div class="text-xs text-muted">目标</div>
          <div class="mt-1 break-all text-sm">{{ latest.target_id }}</div>
        </div>
        <div v-for="[key, value] in resultEntries(latest.result)" :key="key" class="rounded-lg border border-default px-3 py-3">
          <div class="text-xs text-muted">{{ key }}</div>
          <div class="mt-1 break-all text-sm">{{ value }}</div>
        </div>
      </div>
    </UPageCard>

    <UModal
      v-model:open="modalOpen"
      :title="`确认${selected.label}`"
      :description="selected.description"
      :dismissible="!submitting"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="命令类型" required>
            <USelect v-model="draft.kind" :items="[...operationOptions]" value-key="value" label-key="label" class="w-full" />
          </UFormField>
          <UFormField :label="selected.target" description="必须使用权威数据库中的 UUID。" required>
            <UInput v-model="draft.targetId" placeholder="UUID" class="w-full" />
          </UFormField>
          <UFormField label="执行原因" description="至少 10 个字符，将原样写入不可变审计记录。" required>
            <UTextarea v-model="draft.reason" :rows="4" :maxlength="1000" placeholder="说明故障现象、核查依据和执行目的" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" :disabled="submitting" @click="() => { modalOpen = false }">取消</UButton>
        <UButton :loading="submitting" :disabled="!canSubmit" color="warning" @click="() => { void executeOperation() }">确认执行</UButton>
      </template>
    </UModal>
  </UContainer>
</template>
