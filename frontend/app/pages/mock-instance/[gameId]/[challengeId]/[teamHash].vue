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
        title="Mock Challenge Instance"
        description="这是一个实例入口示例页。当前还不是实际容器服务，但会模拟每支队伍的独立实例入口已经被平台成功解析并下发。"
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
            title="Current Lease"
            description="当前实例入口已经按队伍维度解析完成。后续接入真实 provider 时，这里可以替换成真实题目服务。"
            icon="i-lucide-shield-check"
          >
            <div class="space-y-2 text-sm text-muted">
              <div>team_id: {{ teamId || 'unknown' }}</div>
              <div>game_id: {{ gameId }}</div>
              <div>challenge_id: {{ challengeId }}</div>
            </div>
          </UPageCard>

          <UPageCard
            title="Next Step"
            description="如果你是从动态题实例按钮跳过来的，说明当前最小实例租约、模板展开和前端实例入口已经跑通。"
            icon="i-lucide-waypoints"
          >
            <div class="space-y-2 text-sm text-muted">
              <p>下一步可以继续接入真实反代、容器 provider 或平台代理。</p>
              <p>也可以返回比赛页继续验证续期、状态刷新和普通 Flag 提交流程。</p>
            </div>
          </UPageCard>
        </div>
      </UPageCard>
    </div>
  </UContainer>
</template>
