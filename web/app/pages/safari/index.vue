<script setup>
import {useGame} from "~/composables/safari/useGame.ts";
import {useWebSocket} from "~/composables/safari/useWebSocket.ts";

const canvasRef = ref(null);
const logContainerRef = ref(null);
const chatContainerRef = ref(null);
const debugContainerRef = ref(null);
const aiInstruction = ref('');
const expandedLogs = ref(new Set());
const expandedDebug = ref(new Set());
const activeTab = ref('log');
const autoScroll = ref(true);
const selectedModelId = ref('gemini');
const { data: availableModels } = useFetch('/api/safari/models');

const sessionId = crypto.randomUUID()

const { hoverCoord, draw, flashBlocked, handleCanvasMouseMove, handleCanvasMouseLeave } = useGame(canvasRef);
const { player, animals, obstacles, agentLogs, chatMessages, isAgentProcessing, isConnected, lastBlocked, isStopping, debugEntries, sendInit, sendMission, sendStop, sendMove, sendCatch, addLog, clearChat } = useWebSocket(sessionId);

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

function toggleDebug(index) {
  const set = new Set(expandedDebug.value);
  if (set.has(index)) set.delete(index);
  else set.add(index);
  expandedDebug.value = set;
}

function getThoughtText(entry) {
  const parts = entry.response?.raw?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const thoughts = parts.filter(p => p.thought === true).map(p => p.text);
  return thoughts.length > 0 ? thoughts.join('\n') : null;
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
  sendMission(aiInstruction.value, selectedModelId.value);
}

const keyDirMap = {
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
};

const handleKeydown = (e) => {
  if (e.key === ' ') {
    e.preventDefault();
    sendCatch();
    return;
  }
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

watch(debugEntries, () => {
  nextTick(() => scrollToBottom(debugContainerRef.value));
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
        </div>
      </div>

      <aside class="w-[40rem] bg-gray-800 border-l border-gray-700 p-4 flex flex-col gap-3 overflow-hidden">
        <!-- Command input -->
        <div class="shrink-0">
          <h2 class="text-sm font-semibold uppercase text-gray-500 mb-1">Command</h2>
          <div class="flex gap-2 mb-2">
            <select v-model="selectedModelId" class="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 focus:border-blue-500 outline-none">
              <option v-for="m in availableModels" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
          </div>
          <textarea v-model="aiInstruction" placeholder="예: 빨간 호랑이와 분홍 기린을 잡아" class="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm text-blue-100 focus:border-blue-500 outline-none resize-none h-16" />
          <div class="flex gap-2 mt-2">
            <button v-if="!isAgentProcessing" class="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 rounded transition text-sm font-bold" @click="sendToAgent">
              Send
            </button>
            <template v-else>
              <div class="flex-1 py-1.5 bg-gray-700 rounded text-sm font-bold flex items-center justify-center gap-2">
                <span class="animate-spin text-lg">↻</span> Running...
              </div>
              <button
                v-if="!isStopping"
                class="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded transition text-sm font-bold"
                @click="sendStop"
              >
                Stop
              </button>
              <div v-else class="px-3 py-1.5 bg-yellow-700 rounded text-sm font-bold flex items-center gap-1.5 text-yellow-200">
                <span class="animate-pulse">⏳</span> 중단 대기 중...
              </div>
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
            <button
              :class="['px-3 py-1 rounded-t text-xs font-bold transition', activeTab === 'debug' ? 'bg-purple-900/50 text-purple-200' : 'bg-gray-700/50 text-gray-400 hover:text-gray-200']"
              @click="activeTab = 'debug'"
            >Debug</button>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="hoverCoord" class="text-[10px] text-yellow-400 font-mono">Hover: ({{ hoverCoord.x }}, {{ hoverCoord.y }})</span>
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

          <!-- Debug tab (Fine-Tuning View) -->
          <div v-show="activeTab === 'debug'" ref="debugContainerRef" class="bg-black/50 rounded border border-gray-700 p-3 flex-1 overflow-y-auto space-y-2 font-mono text-[11px]">
            <div v-if="debugEntries.length === 0" class="text-gray-600 text-xs text-center py-8">
              에이전트 실행 시 fine-tuning 구조로 표시됩니다.
            </div>
            <div v-for="(entry, i) in debugEntries" :key="i"
              class="rounded-lg border p-2 bg-purple-900/50 border-purple-700"
            >
              <div
                class="flex items-center gap-2 cursor-pointer hover:brightness-125"
                @click="toggleDebug(i)"
              >
                <span class="text-gray-500 text-[9px]">{{ expandedDebug.has(i) ? '▼' : '▶' }}</span>
                <span class="font-bold text-purple-300 text-[10px]">Turn {{ entry.step }}</span>
                <span class="text-gray-500 text-[9px]">{{ entry.time }}</span>
                <span v-if="entry.response?.durationMs" class="text-yellow-400 text-[9px] ml-auto">{{ entry.response.durationMs }}ms</span>
                <span v-if="entry.response?.raw?.usageMetadata" class="text-orange-400 text-[9px]">{{ entry.response.raw.usageMetadata.promptTokenCount ?? '?' }}+{{ entry.response.raw.usageMetadata.candidatesTokenCount ?? '?' }}tok</span>
              </div>

              <div v-if="expandedDebug.has(i)" class="mt-2 space-y-2">
                <!-- ① System Instruction -->
                <div v-if="entry.request?.systemInstruction" class="border-l-2 border-gray-500 pl-2">
                  <div class="text-gray-300 font-bold text-[10px] mb-0.5">① System Instruction</div>
                  <pre class="p-2 bg-gray-900/70 rounded text-[10px] whitespace-pre-wrap break-all text-gray-200 max-h-48 overflow-y-auto">{{ JSON.stringify(entry.request.systemInstruction, null, 2) }}</pre>
                </div>

                <!-- ② User Turn (contents) -->
                <div v-if="entry.request?.contents" class="border-l-2 border-blue-500 pl-2">
                  <div class="text-blue-400 font-bold text-[10px] mb-0.5">② User Turn <span class="text-gray-500 font-normal">(contents[0])</span></div>
                  <pre class="p-2 bg-gray-900/70 rounded text-[10px] whitespace-pre-wrap break-all text-blue-200 max-h-60 overflow-y-auto">{{ JSON.stringify(entry.request.contents, null, 2) }}</pre>
                </div>

                <!-- ②.5 Thought (모델의 사고 과정) -->
                <div v-if="getThoughtText(entry)" class="border-l-2 border-pink-500 pl-2">
                  <div class="text-pink-400 font-bold text-[10px] mb-0.5">② Thought</div>
                  <pre class="p-2 bg-gray-900/70 rounded text-[10px] whitespace-pre-wrap break-all text-pink-200 max-h-60 overflow-y-auto">{{ getThoughtText(entry) }}</pre>
                </div>

                <!-- ③ Model Turn (functionCall from response) -->
                <div v-if="entry.response?.raw?.candidates?.[0]?.content" class="border-l-2 border-green-500 pl-2">
                  <div class="text-green-400 font-bold text-[10px] mb-0.5">③ Model Turn <span class="text-gray-500 font-normal">(functionCall)</span></div>
                  <pre class="p-2 bg-gray-900/70 rounded text-[10px] whitespace-pre-wrap break-all text-green-200 max-h-60 overflow-y-auto">{{ JSON.stringify(entry.response.raw.candidates[0].content, null, 2) }}</pre>
                </div>

                <!-- ④ Function Response (toolResults) -->
                <div v-if="entry.toolResults" class="border-l-2 border-cyan-500 pl-2">
                  <div class="text-cyan-400 font-bold text-[10px] mb-0.5">④ Function Response <span class="text-gray-500 font-normal">(functionResponse)</span></div>
                  <pre class="p-2 bg-gray-900/70 rounded text-[10px] whitespace-pre-wrap break-all text-cyan-200 max-h-60 overflow-y-auto">{{ JSON.stringify({
                    role: 'user',
                    parts: entry.toolResults.map(r => ({ functionResponse: { name: r.name, response: r.result } }))
                  }, null, 2) }}</pre>
                </div>

                <!-- ⑤ Tools (functionDeclarations) -->
                <div v-if="entry.request?.tools" class="border-l-2 border-yellow-500 pl-2">
                  <div class="text-yellow-400 font-bold text-[10px] mb-0.5">⑤ Tools <span class="text-gray-500 font-normal">(functionDeclarations)</span></div>
                  <pre class="p-2 bg-gray-900/70 rounded text-[10px] whitespace-pre-wrap break-all text-yellow-200 max-h-48 overflow-y-auto">{{ JSON.stringify(entry.request.tools, null, 2) }}</pre>
                </div>

                <!-- ⑥ Meta -->
                <div class="border-l-2 border-orange-500 pl-2">
                  <div class="text-orange-400 font-bold text-[10px] mb-0.5">⑥ Meta</div>
                  <div class="p-2 bg-gray-900/70 rounded text-[10px] text-orange-200 space-y-1">
                    <div v-if="entry.response?.durationMs">Duration: {{ entry.response.durationMs }}ms</div>
                    <div v-if="entry.response?.raw?.usageMetadata">
                      Tokens: prompt={{ entry.response.raw.usageMetadata.promptTokenCount ?? '?' }}, candidates={{ entry.response.raw.usageMetadata.candidatesTokenCount ?? '?' }}, total={{ entry.response.raw.usageMetadata.totalTokenCount ?? '?' }}
                    </div>
                    <div v-if="entry.request?.toolConfig">Tool Config: {{ JSON.stringify(entry.request.toolConfig) }}</div>
                    <div v-if="entry.request?.generationConfig">Generation Config: {{ JSON.stringify(entry.request.generationConfig) }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </aside>
    </main>
  </div>
</template>
