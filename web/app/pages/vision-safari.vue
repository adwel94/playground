<script setup>
const canvasRef = ref(null);
const logContainerRef = ref(null);
const lastCapturedImage = ref(null);
const aiInstruction = ref('');
const expandedLogs = ref(new Set());

const { isConnected, agentLogs, isAgentProcessing, addLog, sendMessage, ws } = useAgentWebSocket('vision-safari');
const { player, animals, initGame, draw, movePlayer, captureAgentView, flashBlocked } = useSafariGame(canvasRef);

const logColor = {
  system: 'text-gray-400',
  tool: 'text-cyan-400',
  thinking: 'text-yellow-400',
  prompt: 'text-purple-400',
  response: 'text-green-400',
  memory: 'text-orange-400',
  error: 'text-red-400',
  user: 'text-white',
};

function toggleDetail(index) {
  const set = new Set(expandedLogs.value);
  if (set.has(index)) set.delete(index);
  else set.add(index);
  expandedLogs.value = set;
}

// --- New protocol handlers ---

const handleAgentAction = (data) => {
  switch (data.type) {
    case 'capture_request':
      handleCaptureRequest(data.step_id);
      break;
    case 'move_request':
      handleMoveRequest(data.step_id, data.direction, data.steps || 1);
      break;
    case 'mission_set':
      addLog(`미션 설정: "${data.mission_text}"`, 'system');
      break;
    case 'agent_done':
      addLog('미션 완료 선언!', 'system');
      isAgentProcessing.value = false;
      break;
    case 'agent_log':
      addLog(data.message, data.log_type || 'system', data.detail);
      break;
    case 'agent_error':
      addLog(`에러: ${data.message}`, 'error');
      isAgentProcessing.value = false;
      break;
  }
};

function handleCaptureRequest(stepId) {
  draw(); // ensure canvas is up-to-date
  const image = captureAgentView();
  if (image) {
    lastCapturedImage.value = image;
    sendMessage('capture_response', { step_id: stepId, image });
    addLog(`10×10 에이전트 뷰 전송 (step ${stepId})`, 'system');
  } else {
    sendMessage('capture_response', { step_id: stepId, image: null });
    addLog('에이전트 뷰 캡처 실패', 'error');
  }
}

async function handleMoveRequest(stepId, direction, steps = 1) {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let dx = 0, dy = 0;
  if (direction === 'UP') dy = -1;
  else if (direction === 'DOWN') dy = 1;
  else if (direction === 'LEFT') dx = -1;
  else if (direction === 'RIGHT') dx = 1;

  let actualSteps = 0;
  for (let i = 0; i < steps; i++) {
    if (!movePlayer(dx, dy)) break;
    actualSteps++;
    if (i < steps - 1) await sleep(150);
  }

  const onAnimal = animals.value.find(a => a.x === player.value.x && a.y === player.value.y) || null;
  const response = {
    step_id: stepId,
    moved: actualSteps > 0,
    actual_steps: actualSteps,
    pos: { x: player.value.x, y: player.value.y },
    on_animal: onAnimal ? { emoji: onAnimal.emoji, bgColor: onAnimal.bgColor } : null
  };
  sendMessage('move_response', response);
  let log = `이동 ${direction}×${actualSteps}/${steps} → (${player.value.x}, ${player.value.y})`;
  if (onAnimal) log += ` 동물 위: ${onAnimal.emoji}`;
  addLog(log, 'tool');

  if (actualSteps === 0) {
    addLog(`⛔ 이동 불가! ${direction} 방향 장애물 (나무 또는 맵 경계)`, 'error');
    flashBlocked(direction);
  } else if (actualSteps < steps) {
    addLog(`⚠ 이동 중 막힘: ${steps}칸 중 ${actualSteps}칸만 이동 (장애물)`, 'error');
    flashBlocked(direction);
  }
}

// WebSocket message handler
watch(ws, (newWs) => {
  if (newWs) {
    newWs.onmessage = (event) => {
      try {
        handleAgentAction(JSON.parse(event.data));
      } catch (e) {
        console.error('Failed to parse WS message', e);
      }
    };
  }
}, { immediate: true });

function captureScreen() {
  if (!canvasRef.value) return;
  lastCapturedImage.value = captureAgentView() || canvasRef.value.toDataURL('image/png');
}

async function sendToAgent() {
  if (!aiInstruction.value.trim() || !isConnected.value) return;
  isAgentProcessing.value = true;
  addLog(`유저: ${aiInstruction.value}`, 'user');
  sendMessage('USER_COMMAND', { payload: aiInstruction.value });
}

function stopAgent() {
  sendMessage('STOP_AGENT', {});
  isAgentProcessing.value = false;
  addLog('에이전트 중단됨', 'user');
}

const keyDirMap = {
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
};
const keyDxDy = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

const handleKeydown = (e) => {
  if (!keyDirMap[e.key]) return;
  e.preventDefault();
  const [dx, dy] = keyDxDy[e.key];
  if (!movePlayer(dx, dy)) {
    flashBlocked(keyDirMap[e.key]);
  }
};

watch(agentLogs, () => {
  nextTick(() => {
    if (logContainerRef.value) {
      logContainerRef.value.scrollTop = 0;
    }
  });
}, { deep: true });

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
        <h1 class="text-xl font-bold text-blue-400">Vision Safari Agent v2.0</h1>
        <div class="flex items-center gap-2">
          <p class="text-xs text-gray-400">Grid: 50x50 | View: 10x10 | Autonomous Tool Loop</p>
          <span :class="['w-2 h-2 rounded-full', isConnected ? 'bg-green-500' : 'bg-red-500']"></span>
          <span class="text-[10px] text-gray-500 uppercase font-bold">{{ isConnected ? 'Connected' : 'Disconnected' }}</span>
        </div>
      </div>
      <div class="flex gap-2">
        <button class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition text-sm" @click="initGame(); draw()">Regenerate Map</button>
        <button class="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded transition text-sm font-bold" @click="captureScreen">📸 Preview Agent View</button>
      </div>
    </header>

    <main class="flex-1 flex overflow-hidden">
      <div class="flex-1 overflow-auto p-4 flex justify-center items-start bg-black">
        <div class="relative shadow-2xl border border-gray-600">
          <canvas ref="canvasRef" class="bg-white" style="image-rendering: pixelated;" />
        </div>
      </div>

      <aside class="w-[40rem] bg-gray-800 border-l border-gray-700 p-4 flex flex-col gap-3 overflow-hidden">
        <!-- 상단: Agent View + Command 나란히 -->
        <div class="flex gap-3 shrink-0">
          <!-- Agent View (고정 크기) -->
          <div class="w-40 shrink-0">
            <h2 class="text-sm font-semibold uppercase text-gray-500 mb-1">Agent View</h2>
            <div class="w-40 h-40 bg-gray-900 rounded border border-gray-700 flex items-center justify-center overflow-hidden">
              <img v-if="lastCapturedImage" :src="lastCapturedImage" class="w-full h-full object-contain" >
              <div v-else class="text-gray-600 text-[10px] text-center p-2">에이전트 시야</div>
            </div>
          </div>
          <!-- Command -->
          <div class="flex-1 flex flex-col">
            <h2 class="text-sm font-semibold uppercase text-gray-500 mb-1">Command</h2>
            <textarea v-model="aiInstruction" placeholder="예: 빨간 호랑이와 분홍 기린을 찾아" class="flex-1 bg-gray-900 border border-gray-700 rounded p-2 text-sm text-blue-100 focus:border-blue-500 outline-none resize-none" />
            <div class="flex gap-2 mt-2">
              <button v-if="!isAgentProcessing" class="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 rounded transition text-sm font-bold" @click="sendToAgent">
                Send
              </button>
              <template v-else>
                <div class="flex-1 py-1.5 bg-gray-700 rounded text-sm font-bold flex items-center justify-center gap-2">
                  <span class="animate-spin text-lg">↻</span> Running...
                </div>
                <button class="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded transition text-sm font-bold" @click="stopAgent">
                  Stop
                </button>
              </template>
            </div>
          </div>
        </div>

        <!-- 하단: Agent Log (나머지 전부 차지) -->
        <section class="flex-1 flex flex-col min-h-0">
          <div class="flex items-center justify-between mb-1 shrink-0">
            <h2 class="text-sm font-semibold uppercase text-gray-500">Agent Log</h2>
            <span class="text-[10px] text-gray-500">Player: ({{ player.x }}, {{ player.y }})</span>
          </div>
          <div ref="logContainerRef" class="bg-black/50 rounded border border-gray-700 p-3 flex-1 overflow-y-auto font-mono text-[11px]">
            <div v-for="(log, i) in agentLogs" :key="i" class="mb-1">
              <div
                :class="[logColor[log.logType] || 'text-green-400', log.detail ? 'cursor-pointer hover:brightness-125' : '']"
                @click="log.detail && toggleDetail(i)"
              >
                <span class="text-gray-600">[{{ log.time }}]</span>
                <span v-if="log.detail" class="text-gray-500 mx-0.5 text-[9px]">{{ expandedLogs.has(i) ? '▼' : '▶' }}</span>
                {{ log.msg }}
              </div>
              <pre
                v-if="log.detail && expandedLogs.has(i)"
                class="mt-1 ml-4 p-2 bg-gray-900/70 rounded text-[10px] whitespace-pre-wrap break-all opacity-80 border-l-2"
                :class="[logColor[log.logType] || 'text-green-400', `border-current`]"
              >{{ log.detail }}</pre>
            </div>
          </div>
        </section>
      </aside>
    </main>
  </div>
</template>
