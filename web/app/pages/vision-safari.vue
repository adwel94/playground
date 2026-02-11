<script setup>
const canvasRef = ref(null);
const lastCapturedImage = ref(null);
const aiInstruction = ref('');

// Composables 사용
const { isConnected, agentLogs, isAgentProcessing, addLog, sendMessage, ws } = useAgentWebSocket('vision-safari');
const { player, initGame, draw, movePlayer } = useSafariGame(canvasRef);

// 게임 액션 처리
const handleAgentAction = (data) => {
  switch (data.action) {
    case 'CAPTURE_SCREEN':
      captureAndSendScreen();
      break;
    case 'MOVE':
      handleMoveCommand(data.direction, data.steps || 1);
      break;
  }
};

// WebSocket 메시지 핸들러 직접 연결
watch(ws, (newWs) => {
  if (newWs) {
    newWs.onmessage = (event) => {
      handleAgentAction(JSON.parse(event.data));
    };
  }
}, { immediate: true });

function captureScreen() {
  if (!canvasRef.value) return;
  lastCapturedImage.value = canvasRef.value.toDataURL('image/png');
}

function captureAndSendScreen() {
  captureScreen();
  sendMessage('SCREEN_DATA', { image: lastCapturedImage.value });
  addLog("System: Sent screen data to Agent.");
}

function handleMoveCommand(direction, steps) {
  addLog(`Agent: Moving ${direction} ${steps} step(s).`);
  let dx = 0, dy = 0;
  if (direction === 'UP') dy = -1;
  else if (direction === 'DOWN') dy = 1;
  else if (direction === 'LEFT') dx = -1;
  else if (direction === 'RIGHT') dx = 1;

  for (let i = 0; i < steps; i++) movePlayer(dx, dy);
  sendMessage('MOVE_COMPLETE', { pos: player.value });
}

async function sendToAgent() {
  if (!aiInstruction.value.trim() || !isConnected.value) return;
  isAgentProcessing.value = true;
  addLog(`User: ${aiInstruction.value}`);
  sendMessage('USER_COMMAND', { payload: aiInstruction.value });
  
  setTimeout(() => { isAgentProcessing.value = false; }, 2000);
}

const handleKeydown = (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
  if (e.key === 'ArrowUp') movePlayer(0, -1);
  if (e.key === 'ArrowDown') movePlayer(0, 1);
  if (e.key === 'ArrowLeft') movePlayer(-1, 0);
  if (e.key === 'ArrowRight') movePlayer(1, 0);
};

onMounted(() => {
  initGame();
  setTimeout(draw, 100);
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="flex flex-col h-screen bg-gray-900 text-white font-sans overflow-hidden">
    <header class="p-4 bg-gray-800 border-b border-gray-700 flex justify-between items-center">
      <div>
        <h1 class="text-xl font-bold text-blue-400">Vision Safari Agent v1.0</h1>
        <div class="flex items-center gap-2">
          <p class="text-xs text-gray-400">Grid: 50x50 | Target: Visual Navigation</p>
          <span :class="['w-2 h-2 rounded-full', isConnected ? 'bg-green-500' : 'bg-red-500']"></span>
          <span class="text-[10px] text-gray-500 uppercase font-bold">{{ isConnected ? 'Connected' : 'Disconnected' }}</span>
        </div>
      </div>
      <div class="flex gap-2">
        <button class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition text-sm" @click="initGame(); draw()">Regenerate Map</button>
        <button class="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded transition text-sm font-bold" @click="captureAndSendScreen">📸 Capture for AI</button>
      </div>
    </header>

    <main class="flex-1 flex overflow-hidden">
      <div class="flex-1 overflow-auto p-8 flex justify-center items-start bg-black">
        <div class="relative shadow-2xl border border-gray-600">
          <canvas ref="canvasRef" class="bg-white" style="image-rendering: pixelated;" />
        </div>
      </div>

      <aside class="w-80 bg-gray-800 border-l border-gray-700 p-4 flex flex-col gap-6 overflow-y-auto">
        <section>
          <h2 class="text-sm font-semibold uppercase text-gray-500 mb-2">Agent View</h2>
          <div class="aspect-square bg-gray-900 rounded border border-gray-700 flex items-center justify-center overflow-hidden">
            <img v-if="lastCapturedImage" :src="lastCapturedImage" class="w-full h-full object-contain" >
            <div v-else class="text-gray-600 text-xs text-center p-4">Click "Capture for AI" to see what the agent sees.</div>
          </div>
        </section>

        <section>
          <h2 class="text-sm font-semibold uppercase text-gray-500 mb-2">Command to Agent</h2>
          <div class="flex flex-col gap-2">
            <textarea v-model="aiInstruction" placeholder="e.g., Go to the tiger on the red background" class="w-full h-24 bg-gray-900 border border-gray-700 rounded p-2 text-sm text-blue-100 focus:border-blue-500 outline-none resize-none" />
            <button :disabled="isAgentProcessing" class="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 rounded transition text-sm font-bold flex items-center justify-center gap-2" @click="sendToAgent">
              <span v-if="isAgentProcessing" class="animate-spin text-lg">↻</span>
              {{ isAgentProcessing ? 'Agent Thinking...' : 'Send Command' }}
            </button>
          </div>
        </section>

        <section class="flex-1">
          <h2 class="text-sm font-semibold uppercase text-gray-500 mb-2">Agent Log</h2>
          <div class="bg-black/50 rounded border border-gray-700 p-3 h-48 overflow-y-auto font-mono text-[11px] text-green-400">
            <div v-for="(log, i) in agentLogs" :key="i" class="mb-1">
              <span class="text-gray-600">[{{ log.time }}]</span> {{ log.msg }}
            </div>
          </div>
        </section>

        <footer class="text-[10px] text-gray-500 pt-4 border-t border-gray-700">Player Pos: ({{ player.x }}, {{ player.y }})</footer>
      </aside>
    </main>
  </div>
</template>