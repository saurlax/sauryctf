<script setup lang="ts">
const features = [
  {
    title: '动态容器',
    description: '基于 k3s 的动态题目容器，每队独立实例，自动生命周期管理',
    icon: 'i-lucide-server',
  },
  {
    title: '实时排行',
    description: '动态计分系统，支持三血奖励、分组榜、时间线回放',
    icon: 'i-lucide-trophy',
  },
  {
    title: '队伍协作',
    description: '队伍创建、邀请、审核，支持比赛分组和队伍锁定',
    icon: 'i-lucide-users',
  },
  {
    title: '安全隔离',
    description: 'NetworkPolicy 隔离、资源配额控制、审计日志全程记录',
    icon: 'i-lucide-shield',
  },
]
</script>

<template>
  <div>
    <UPageHero
      title="SauryCTF"
      description="基于 k3s 的现代化 CTF/AWD 竞赛平台"
      :links="[
        { label: '开始比赛', to: '/games', icon: 'i-lucide-rocket' },
        { label: '了解更多', to: '#features', variant: 'outline', icon: 'i-lucide-info' },
      ]"
    />

    <UPageSection id="features" title="平台特色" description="为 CTF 竞赛打造的一站式平台">
      <UPageGrid>
        <UPageCard
          v-for="feature in features"
          :key="feature.title"
          :title="feature.title"
          :description="feature.description"
          :icon="feature.icon"
        />
      </UPageGrid>
    </UPageSection>
  </div>
</template>
