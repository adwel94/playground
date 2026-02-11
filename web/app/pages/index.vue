<template>
  <div class="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
    <h1 class="text-4xl font-bold mb-8 text-blue-400">LLM Agent Playground</h1>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl w-full">
      <NuxtLink 
        to="/vision-safari" 
        class="group p-6 bg-gray-800 border border-gray-700 rounded-xl hover:border-blue-500 transition-all hover:scale-105"
      >
        <h2 class="text-2xl font-bold mb-2 group-hover:text-blue-400 transition-colors">Vision Safari</h2>
        <p class="text-gray-400 text-sm">
          A 100x100 grid game designed for training Vision-based AI Agents. 
          Identify targets by color and emoji, navigate through obstacles.
        </p>
        <div class="mt-4 inline-block px-4 py-2 bg-blue-600 rounded text-sm font-bold">Start Game</div>
      </NuxtLink>
      
      <div class="p-6 bg-gray-800/50 border border-gray-700/50 rounded-xl flex items-center justify-center italic text-gray-500">
        More games coming soon...
      </div>
    </div>
  </div>
</template>