<script setup lang="ts">
import type { components } from '~/types/api'

type Game = components['schemas']['Game']

const { data: games, error, refresh, status } = await useAsyncData(
  'public-scoreboard-games',
  () => $api('get', '/api/games'),
  { default: () => [] },
)

const scoreboardCards = computed(() => games.value.map(game => ({
  title: game.name,
  description: scoreboardDescription(game),
  icon: 'i-lucide-trophy',
  to: `/games/${game.id}?tab=scoreboard`,
})))

function scoreboardDescription(game: Game): string {
  const endAt = new Date(game.end_time).getTime()
  const startAt = new Date(game.start_time).getTime()
  const now = Date.now()
  if (game.status === 'ended' || now > endAt) return '比赛已结束，查看最终公开排名。'
  if (now < startAt) return `比赛将于 ${new Date(game.start_time).toLocaleString()} 开始。`
  return '比赛进行中，查看实时公开排名。'
}
</script>

<template>
  <UPage>
    <UPageHeader
      headline="公开赛事"
      title="排行榜"
      description="选择一场比赛，查看实时或最终公开排名。"
    />

    <UPageBody>
      <UEmpty
        v-if="status === 'pending'"
        loading
        icon="i-lucide-trophy"
        title="正在加载排行榜"
        description="正在获取公开比赛列表。"
      />

      <UEmpty
        v-else-if="error"
        icon="i-lucide-circle-alert"
        title="排行榜加载失败"
        description="暂时无法获取公开比赛，请稍后重试。"
        :actions="[{ label: '重新加载', icon: 'i-lucide-refresh-cw', onClick: () => refresh() }]"
      />

      <UEmpty
        v-else-if="scoreboardCards.length === 0"
        icon="i-lucide-trophy"
        title="暂无公开排行榜"
        description="公开比赛发布后，排行榜入口会显示在这里。"
        :actions="[{ label: '浏览比赛', icon: 'i-lucide-flag', to: '/games' }]"
      />

      <UPageGrid v-else>
        <UPageCard
          v-for="card in scoreboardCards"
          :key="card.to"
          v-bind="card"
          spotlight
        />
      </UPageGrid>
    </UPageBody>
  </UPage>
</template>
