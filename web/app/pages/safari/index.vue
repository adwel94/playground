<script setup>
import {useGame} from "~/composables/safari/useGame.ts";
import {useWebSocket} from "~/composables/safari/useWebSocket.ts";

const canvasRef = ref(null);
const logContainerRef = ref(null);
const chatContainerRef = ref(null);
const aiInstruction = ref('');
const expandedLogs = ref(new Set());
const activeTab = ref('log');
const autoScroll = ref(true);

const sessionId = crypto.randomUUID()

const { hoverCoord, draw, flashBlocked, handleCanvasMouseMove, handleCanvasMouseLeave } = useGame(canvasRef);
const { player, animals, obstacles, agentLogs, chatMessages, isAgentProcessing, isConnected, lastBlocked, isStopping, sendInit, sendMission, sendStop, sendMove, addLog, clearChat } = useWebSocket(sessionId);

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

const chatBubbleStyle = {
  system: 'bg-gray-700/50 border-gray-600 text-gray-300',
  human: 'bg-blue-900/50 border-blue-700 text-blue-100',
  ai: 'bg-green-900/50 border-green-700 text-green-100',
  tool: 'bg-cyan-900/50 border-cyan-700 text-cyan-100',
};

const chatRoleLabel = {
  system: 'System',
  human: 'Human',
  ai: 'AI',
  tool: 'Tool',
};

const chatRoleColor = {
  system: 'text-gray-400',
  human: 'text-blue-400',
  ai: 'text-green-400',
  tool: 'text-cyan-400',
};

function toggleDetail(index) {
  const set = new Set(expandedLogs.value);
  if (set.has(index)) set.delete(index);
  else set.add(index);
  expandedLogs.value = set;
}

function scrollToBottom(el) {
  if (el && autoScroll.value) {
    el.scrollTop = el.scrollHeight;
  }
}

function redraw() {
  draw(player.value, animals.value, obstacles.value);
}

async function sendToAgent() {
  if (!aiInstruction.value.trim()) return;
  clearChat();
  sendMission(aiInstruction.value);
}

const keyDirMap = {
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
};

const handleKeydown = (e) => {
  if (!keyDirMap[e.key]) return;
  e.preventDefault();
  sendMove(keyDirMap[e.key], 1);
};

// Flash red when blocked
watch(lastBlocked, (val) => {
  if (val) {
    flashBlocked(val.direction, val.pos, animals.value, obstacles.value);
    lastBlocked.value = null;
  }
});

// Redraw when state changes
watch([player, animals, obstacles], () => {
  nextTick(redraw);
}, { deep: true });

// Auto scroll
watch(agentLogs, () => {
  nextTick(() => scrollToBottom(logContainerRef.value));
}, { deep: true });

watch(chatMessages, () => {
  nextTick(() => scrollToBottom(chatContainerRef.value));
}, { deep: true });

onMounted(() => {
  setTimeout(redraw, 200);
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
        <h1 class="text-xl font-bold text-blue-400">Vision Safari Agent v3.0</h1>
        <div class="flex items-center gap-2">
          <p class="text-xs text-gray-400">Grid: 50x50 | View: 10x10 | Server-side Agent (Playwright)</p>
          <span :class="['w-2 h-2 rounded-full', isConnected ? 'bg-green-500' : 'bg-red-500']"></span>
          <span class="text-[10px] text-gray-500 uppercase font-bold">{{ isConnected ? 'Connected' : 'Disconnected' }}</span>
        </div>
      </div>
      <div class="flex gap-2">
        <button class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition text-sm" @click="sendInit()">Regenerate Map</button>
      </div>
    </header>

    <main class="flex-1 flex overflow-hidden">
      <div class="flex-1 overflow-auto p-4 flex justify-center items-start bg-black">
        <div class="relative shadow-2xl border border-gray-600">
          <canvas ref="canvasRef" class="bg-white" style="image-rendering: pixelated;" @mousemove="handleCanvasMouseMove" @mouseleave="handleCanvasMouseLeave" />
          <div v-if="hoverCoord" class="absolute top-1 left-1 bg-black/70 text-white text-[11px] font-mono px-1.5 py-0.5 rounded pointer-events-none">
            ({{ hoverCoord.x }}, {{ hoverCoord.y }})
          </div>
        </div>
      </div>

      <aside class="w-[40rem] bg-gray-800 border-l border-gray-700 p-4 flex flex-col gap-3 overflow-hidden">
        <!-- Command input -->
        <div class="shrink-0">
          <h2 class="text-sm font-semibold uppercase text-gray-500 mb-1">Command</h2>
          <textarea v-model="aiInstruction" placeholder="예: 빨간 호랑이와 분홍 기린을 찾아" class="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm text-blue-100 focus:border-blue-500 outline-none resize-none h-16" />
          <div class="flex gap-2 mt-2">
            <button v-if="!isAgentProcessing" class="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 rounded transition text-sm font-bold" @click="sendToAgent">
              Send
            </button>
            <template v-else>
              <div class="flex-1 py-1.5 bg-gray-700 rounded text-sm font-bold flex items-center justify-center gap-2">
                <span class="animate-spin text-lg">↻</span> Running...
              </div>
              <button class="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded transition text-sm font-bold" @click="sendStop">
                Stop
              </button>
            </template>
          </div>
        </div>

        <!-- Tab header + auto-scroll toggle -->
        <div class="flex items-center justify-between shrink-0">
          <div class="flex gap-1">
            <button
              :class="['px-3 py-1 rounded-t text-xs font-bold transition', activeTab === 'log' ? 'bg-black/50 text-white' : 'bg-gray-700/50 text-gray-400 hover:text-gray-200']"
              @click="activeTab = 'log'"
            >Agent Log</button>
            <button
              :class="['px-3 py-1 rounded-t text-xs font-bold transition', activeTab === 'chat' ? 'bg-black/50 text-white' : 'bg-gray-700/50 text-gray-400 hover:text-gray-200']"
              @click="activeTab = 'chat'"
            >AI Chat</button>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-gray-500">Player: ({{ player.x }}, {{ player.y }})</span>
            <button
              :class="['text-[10px] px-1.5 py-0.5 rounded transition', autoScroll ? 'bg-green-700 text-green-200' : 'bg-gray-700 text-gray-400']"
              @click="autoScroll = !autoScroll"
            >Auto↓ {{ autoScroll ? 'ON' : 'OFF' }}</button>
          </div>
        </div>

        <!-- Tab content -->
        <section class="flex-1 flex flex-col min-h-0">
          <!-- Agent Log tab -->
          <div v-show="activeTab === 'log'" ref="logContainerRef" class="bg-black/50 rounded border border-gray-700 p-3 flex-1 overflow-y-auto font-mono text-[11px]">
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
                :class="[logColor[log.logType] || 'text-green-400', 'border-current']"
              >{{ log.detail }}</pre>
            </div>
          </div>

          <!-- AI Chat tab -->
          <div v-show="activeTab === 'chat'" ref="chatContainerRef" class="bg-black/50 rounded border border-gray-700 p-3 flex-1 overflow-y-auto space-y-2">
            <div v-if="chatMessages.length === 0" class="text-gray-600 text-xs text-center py-8">
              에이전트 실행 시 AI와의 대화 내역이 여기에 표시됩니다.
            </div>
            <div v-for="(msg, i) in chatMessages" :key="i"
              :class="['rounded-lg border p-2 text-[11px]', chatBubbleStyle[msg.role] || 'bg-gray-800 border-gray-600 text-gray-300']"
            >
              <div class="flex items-center gap-2 mb-1">
                <span :class="['font-bold text-[10px]', chatRoleColor[msg.role] || 'text-gray-400']">{{ chatRoleLabel[msg.role] || msg.role }}</span>
                <span class="text-gray-600 text-[9px]">{{ msg.time }}</span>
              </div>
              <img v-if="msg.image" :src="msg.image" class="w-32 h-32 object-contain rounded border border-gray-600 mb-1" alt="view">
              <pre class="whitespace-pre-wrap break-all text-[11px] leading-relaxed">{{ msg.content }}</pre>
            </div>
          </div>
        </section>
      </aside>
    </main>
  </div>
</template>
