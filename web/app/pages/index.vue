<template>
  <div class="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
    <h1 class="text-4xl font-bold mb-8 text-blue-400">LLM Agent Playground</h1>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl w-full">
      <NuxtLink
        v-for="game in games"
        :key="game.to"
        :to="game.to"
        class="group p-6 bg-gray-800 border border-gray-700 rounded-xl hover:border-blue-500 transition-all hover:scale-105"
      >
        <div class="flex items-center gap-2 mb-2">
          <span class="text-2xl">{{ game.icon }}</span>
          <h2 class="text-xl font-bold group-hover:text-blue-400 transition-colors">{{ game.title }}</h2>
        </div>
        <p class="text-gray-400 text-sm leading-relaxed">{{ game.description }}</p>
        <div class="mt-4 inline-block px-4 py-2 bg-blue-600 rounded text-sm font-bold">Start</div>
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
const games = [
  {
    to: '/safari',
    icon: '🌍',
    title: 'Vision Safari',
    description: '50x50 그리드에서 동물을 찾아 포획하는 게임. Vision AI 에이전트가 이동, 탐색, 포획을 수행합니다.',
  },
  {
    to: '/emoji-recognition',
    icon: '🔍',
    title: 'Emoji Recognition',
    description: '10x10 뷰포트에서 동물 이모지의 종류, 배경색, 위치를 식별하는 게임. V1 학습 데이터 자동 수집용.',
  },
]
</script>
