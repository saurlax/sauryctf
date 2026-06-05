<script setup lang="ts">
const route = useRoute()

const gameId = computed(() => String(route.params.gameId || ''))
const challengeId = computed(() => String(route.params.challengeId || ''))
const teamHash = computed(() => String(route.params.teamHash || ''))
const teamId = computed(() => typeof route.query.team === 'string' ? route.query.team : '')

const pageLinks = computed(() => [
  {
    label: '返回比赛页',
    to: `/games/${gameId.value}`,
    icon: 'i-lucide-arrow-left',
    variant: 'outline' as const,
  },
  {
    label: '打开控制台',
    to: '/console',
    icon: 'i-lucide-layout-dashboard',
    variant: 'soft' as const,
  },
])
</script>

<template>
  <UContainer class="py-12">
    <div class="mx-auto flex max-w-4xl flex-col gap-6">
      <UPageCard
        title="实例访问页"
        description="这是当前实例入口的本地访问页，用于承接按队伍解析后的独立地址，并方便继续核对实例链路。"
        icon="i-lucide-box"
      >
        <template #footer>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="link in pageLinks"
              :key="link.label"
              :to="link.to"
              :icon="link.icon"
              :variant="link.variant"
              size="sm"
            >
              {{ link.label }}
            </UButton>
          </div>
        </template>

        <div class="grid gap-4 md:grid-cols-3">
          <UPageCard title="Game" :description="gameId" icon="i-lucide-trophy" />
          <UPageCard title="Challenge" :description="challengeId" icon="i-lucide-flag" />
          <UPageCard title="Team Hash" :description="teamHash" icon="i-lucide-fingerprint" />
        </div>

        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <UPageCard
            title="当前租约"
            description="当前入口已经完成队伍维度解析。后续接入真实服务后，这里可以替换为实际题目环境。"
            icon="i-lucide-shield-check"
          >
            <div class="space-y-2 text-sm text-muted">
              <div>team_id: {{ teamId || 'unknown' }}</div>
              <div>game_id: {{ gameId }}</div>
              <div>challenge_id: {{ challengeId }}</div>
            </div>
          </UPageCard>

          <UPageCard
            title="后续步骤"
            description="如果你是从比赛页进入这里，说明当前实例地址已经成功下发，可以继续核对入口、续期和销毁流程。"
            icon="i-lucide-waypoints"
          >
            <div class="space-y-2 text-sm text-muted">
              <p>下一步可以继续接入真实网关、容器调度或平台代理。</p>
              <p>也可以返回比赛页继续核对续期、状态同步和提交流程。</p>
            </div>
          </UPageCard>
        </div>
      </UPageCard>
    </div>
  </UContainer>
</template>
