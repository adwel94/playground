<script setup lang="ts">
import { useGridRenderer } from '~/composables/shared/useGridRenderer'

const TILE_SIZE = 48
const CANVAS_PX = 10 * TILE_SIZE // 480

const canvasRef = ref<HTMLCanvasElement | null>(null)
const logContainerRef = ref<HTMLElement | null>(null)
const resultContainerRef = ref<HTMLElement | null>(null)
const { drawViewport } = useGridRenderer(canvasRef)

const player = ref({ x: 25, y: 25 })
const animals = ref<any[]>([])
const obstacles = ref<any[]>([])
const isConnected = ref(false)
const isRunning = ref(false)
const selectedModelId = ref('gemini')
const { data: availableModels } = useFetch('/api/emoji-recognition/models')

// Round info
const roundNumber = ref(0)
const answerText = ref('')
const llmResponse = ref('')
const thoughtText = ref('')
const validationResult = ref<any>(null)

// Progress
const progressCurrent = ref(0)
const progressTotal = ref(0)
const progressCorrect = ref(0)

// Logs
const logs = ref<Array<{ time: string; msg: string; logType: string }>>([])

// Results history
const results = ref<Array<{
  roundNumber: number
  answer: string
  llmResponse: string
  thought: string
  validation: any
  isCorrect: boolean
}>>([])

// Auto rounds input
const autoRounds = ref(50)

// Tab + auto-scroll
const activeTab = ref<'log' | 'result'>('log')
const autoScroll = ref(true)
const expandedResults = ref(new Set<number>())

let ws: WebSocket | null = null

const logColor: Record<string, string> = {
  system: 'text-gray-400',
  success: 'text-green-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function addLog(msg: string, logType = 'system') {
  logs.value.push({ time: nowTime(), msg, logType })
  if (logs.value.length > 300) logs.value.shift()
}

function scrollToBottom(el: HTMLElement | null) {
  if (el && autoScroll.value) {
    el.scrollTop = el.scrollHeight
  }
}

function redraw() {
  drawViewport({ player: player.value, animals: animals.value, obstacles: obstacles.value, tileSize: TILE_SIZE })
}

function captureAndSend() {
  const canvas = canvasRef.value
  if (!canvas || !ws || ws.readyState !== WebSocket.OPEN) return
  const dataUrl = canvas.toDataURL('image/png')
  ws.send(JSON.stringify({ type: 'screenshot', data: dataUrl }))
}

function toggleResult(index: number) {
  const set = new Set(expandedResults.value)
  if (set.has(index)) set.delete(index)
  else set.add(index)
  expandedResults.value = set
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const sessionId = crypto.randomUUID()
  ws = new WebSocket(`${protocol}//${location.host}/_ws/emoji-recognition?sessionId=${sessionId}`)

  ws.onopen = () => {
    isConnected.value = true
    addLog('WebSocket 연결됨')
  }

  ws.onclose = () => {
    isConnected.value = false
    isRunning.value = false
    addLog('WebSocket 연결 끊김')
    setTimeout(connect, 2000)
  }

  ws.onmessage = (event) => {
    let msg: any
    try { msg = JSON.parse(event.data) } catch { return }

    switch (msg.type) {
      case 'gameState':
        player.value = msg.state.player
        animals.value = msg.state.animals
        obstacles.value = msg.state.obstacles
        nextTick(redraw)
        break

      case 'roundInfo':
        roundNumber.value = msg.roundNumber
        answerText.value = msg.answer
        llmResponse.value = ''
        thoughtText.value = ''
        validationResult.value = null
        break

      case 'needScreenshot':
        // Server requests a screenshot — render then capture
        nextTick(() => {
          redraw()
          nextTick(captureAndSend)
        })
        break

      case 'roundResult':
        llmResponse.value = msg.llmResponse
        thoughtText.value = msg.thought || ''
        validationResult.value = msg.validation
        answerText.value = msg.answer
        results.value.push({
          roundNumber: msg.roundNumber,
          answer: msg.answer,
          llmResponse: msg.llmResponse,
          thought: msg.thought || '',
          validation: msg.validation,
          isCorrect: msg.validation.missed.length === 0 && msg.validation.wrong.length === 0,
        })
        if (results.value.length > 200) results.value.shift()
        break

      case 'progress':
        progressCurrent.value = msg.current
        progressTotal.value = msg.total
        progressCorrect.value = msg.correct
        break

      case 'log':
        addLog(msg.msg, msg.logType)
        break

      case 'autoComplete':
        isRunning.value = false
        addLog(`자동 플레이 완료: ${msg.correct}/${msg.total} 정답`)
        break
    }
  }
}

function send(data: any) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data))
  }
}

function nextRound() {
  send({ type: 'next-round' })
}

function startAuto() {
  isRunning.value = true
  progressCurrent.value = 0
  progressTotal.value = autoRounds.value
  progressCorrect.value = 0
  logs.value = []
  results.value = []
  send({ type: 'start-auto', rounds: autoRounds.value, modelId: selectedModelId.value })
}

function stop() {
  send({ type: 'stop' })
  addLog('중지 요청됨...')
}

const accuracy = computed(() => {
  if (progressCurrent.value === 0) return 0
  return Math.round(progressCorrect.value / progressCurrent.value * 100)
})

// Auto scroll watchers
watch(logs, () => {
  nextTick(() => scrollToBottom(logContainerRef.value))
}, { deep: true })

watch(results, () => {
  nextTick(() => scrollToBottom(resultContainerRef.value))
}, { deep: true })

onMounted(() => connect())
onUnmounted(() => { if (ws) ws.close() })
</script>

<template>
  <div class="flex flex-col h-screen bg-gray-900 text-white font-sans overflow-hidden">
    <!-- Header -->
    <header class="p-4 bg-gray-800 border-b border-gray-700 flex justify-between items-center">
      <div>
        <h1 class="text-xl font-bold text-blue-400">Emoji Recognition v1</h1>
        <div class="flex items-center gap-2">
          <p class="text-xs text-gray-400">Grid: 50×50 | View: 10×10 | Client Canvas Capture</p>
          <span :class="['w-2 h-2 rounded-full', isConnected ? 'bg-green-500' : 'bg-red-500']" />
          <span class="text-[10px] text-gray-500 uppercase font-bold">{{ isConnected ? 'Connected' : 'Disconnected' }}</span>
        </div>
      </div>
      <div class="flex gap-2">
        <button
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition text-sm"
          :disabled="isRunning"
          @click="nextRound"
        >
          다음 라운드
        </button>
      </div>
    </header>

    <!-- Main -->
    <main class="flex-1 flex overflow-hidden">
      <!-- Left: Canvas area -->
      <div class="flex-1 overflow-auto p-4 flex flex-col justify-center items-center bg-black gap-4">
        <div class="relative shadow-2xl border border-gray-600">
          <canvas
            ref="canvasRef"
            :width="CANVAS_PX"
            :height="CANVAS_PX"
            class="bg-white block"
            style="image-rendering: pixelated;"
          />
        </div>
        <!-- Progress bar below canvas -->
        <div v-if="progressTotal > 0" class="w-[480px] space-y-1">
          <div class="flex justify-between text-xs text-gray-400">
            <span>라운드: {{ roundNumber }}</span>
            <span>진행: {{ progressCurrent }}/{{ progressTotal }}</span>
            <span v-if="progressCurrent > 0" class="font-medium" :class="accuracy >= 70 ? 'text-green-400' : 'text-red-400'">
              정답률: {{ accuracy }}%
            </span>
          </div>
          <div class="w-full bg-gray-700 rounded-full h-2">
            <div
              class="bg-blue-500 h-2 rounded-full transition-all duration-300"
              :style="{ width: `${(progressCurrent / progressTotal) * 100}%` }"
            />
          </div>
        </div>
      </div>

      <!-- Right: Aside panel -->
      <aside class="w-[40rem] bg-gray-800 border-l border-gray-700 p-4 flex flex-col gap-3 overflow-hidden">
        <!-- Command section -->
        <div class="shrink-0">
          <h2 class="text-sm font-semibold uppercase text-gray-500 mb-1">Command</h2>
          <div class="flex gap-2 mb-2">
            <select
              v-model="selectedModelId"
              class="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 focus:border-blue-500 outline-none"
              :disabled="isRunning"
            >
              <option v-for="m in availableModels" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
          </div>
          <div class="flex gap-2 items-center">
            <input
              v-model.number="autoRounds"
              type="number"
              min="1"
              max="500"
              class="w-20 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:border-blue-500 outline-none"
              :disabled="isRunning"
            >
            <span class="text-xs text-gray-500">라운드</span>
            <button
              v-if="!isRunning"
              class="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 rounded transition text-sm font-bold"
              @click="startAuto"
            >
              자동 플레이
            </button>
            <template v-else>
              <div class="flex-1 py-1.5 bg-gray-700 rounded text-sm font-bold flex items-center justify-center gap-2">
                <span class="animate-spin text-lg">↻</span> Running...
              </div>
              <button
                class="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded transition text-sm font-bold"
                @click="stop"
              >
                중지
              </button>
            </template>
          </div>
          <!-- Inline progress -->
          <div v-if="progressTotal > 0" class="mt-2 text-xs text-gray-400 flex gap-3">
            <span>{{ progressCurrent }}/{{ progressTotal }}</span>
            <span v-if="progressCurrent > 0" :class="accuracy >= 70 ? 'text-green-400' : 'text-red-400'">
              정답률 {{ accuracy }}%
            </span>
          </div>
        </div>

        <!-- Tab header + auto-scroll toggle -->
        <div class="flex items-center justify-between shrink-0">
          <div class="flex gap-1">
            <button
              :class="['px-3 py-1 rounded-t text-xs font-bold transition', activeTab === 'log' ? 'bg-black/50 text-white' : 'bg-gray-700/50 text-gray-400 hover:text-gray-200']"
              @click="activeTab = 'log'"
            >
              Agent Log
            </button>
            <button
              :class="['px-3 py-1 rounded-t text-xs font-bold transition', activeTab === 'result' ? 'bg-black/50 text-white' : 'bg-gray-700/50 text-gray-400 hover:text-gray-200']"
              @click="activeTab = 'result'"
            >
              결과
            </button>
          </div>
          <button
            :class="['text-[10px] px-1.5 py-0.5 rounded transition', autoScroll ? 'bg-green-700 text-green-200' : 'bg-gray-700 text-gray-400']"
            @click="autoScroll = !autoScroll"
          >
            Auto↓ {{ autoScroll ? 'ON' : 'OFF' }}
          </button>
        </div>

        <!-- Tab content -->
        <section class="flex-1 flex flex-col min-h-0">
          <!-- Agent Log tab -->
          <div
            v-show="activeTab === 'log'"
            ref="logContainerRef"
            class="bg-black/50 rounded border border-gray-700 p-3 flex-1 overflow-y-auto font-mono text-[11px]"
          >
            <div v-for="(log, i) in logs" :key="i" class="mb-1">
              <div :class="logColor[log.logType] || 'text-gray-400'">
                <span class="text-gray-600">[{{ log.time }}]</span>
                {{ log.msg }}
              </div>
            </div>
            <div v-if="logs.length === 0" class="text-gray-600 text-xs text-center py-8">
              로그가 없습니다
            </div>
          </div>

          <!-- Result tab -->
          <div
            v-show="activeTab === 'result'"
            ref="resultContainerRef"
            class="bg-black/50 rounded border border-gray-700 p-3 flex-1 overflow-y-auto space-y-2 font-mono text-[11px]"
          >
            <div v-if="results.length === 0" class="text-gray-600 text-xs text-center py-8">
              자동 플레이 시 라운드별 결과가 여기에 표시됩니다.
            </div>
            <div
              v-for="(r, i) in results"
              :key="i"
              :class="['rounded-lg border p-2', r.isCorrect ? 'bg-green-900/30 border-green-700' : 'bg-red-900/30 border-red-700']"
            >
              <div
                class="flex items-center gap-2 cursor-pointer hover:brightness-125"
                @click="toggleResult(i)"
              >
                <span class="text-gray-500 text-[9px]">{{ expandedResults.has(i) ? '▼' : '▶' }}</span>
                <span :class="['font-bold text-[10px]', r.isCorrect ? 'text-green-400' : 'text-red-400']">
                  R{{ r.roundNumber }} {{ r.isCorrect ? '✓' : '✗' }}
                </span>
                <span class="text-gray-500 text-[9px] ml-auto truncate max-w-[200px]">{{ r.answer }}</span>
              </div>

              <div v-if="expandedResults.has(i)" class="mt-2 space-y-2">
                <!-- 정답 -->
                <div class="border-l-2 border-gray-500 pl-2">
                  <div class="text-gray-300 font-bold text-[10px] mb-0.5">정답</div>
                  <pre class="p-2 bg-gray-900/70 rounded text-[10px] whitespace-pre-wrap break-all text-gray-200">{{ r.answer }}</pre>
                </div>

                <!-- LLM 응답 -->
                <div class="border-l-2 border-blue-500 pl-2">
                  <div class="text-blue-400 font-bold text-[10px] mb-0.5">LLM 응답</div>
                  <pre class="p-2 bg-gray-900/70 rounded text-[10px] whitespace-pre-wrap break-all text-blue-200">{{ r.llmResponse }}</pre>
                </div>

                <!-- 사고 과정 -->
                <div v-if="r.thought" class="border-l-2 border-pink-500 pl-2">
                  <div class="text-pink-400 font-bold text-[10px] mb-0.5">사고 과정</div>
                  <pre class="p-2 bg-gray-900/70 rounded text-[10px] whitespace-pre-wrap break-all text-pink-200 max-h-32 overflow-y-auto">{{ r.thought }}</pre>
                </div>

                <!-- 검증 -->
                <div class="border-l-2 border-green-500 pl-2">
                  <div class="text-green-400 font-bold text-[10px] mb-0.5">검증</div>
                  <div class="p-2 bg-gray-900/70 rounded text-[10px] space-y-0.5">
                    <div v-for="c in r.validation.correct" :key="'c'+c.viewportX+c.viewportY" class="text-green-400">
                      ✓ {{ c.colorName }} {{ c.name }}({{ c.emoji }}) at ({{ c.viewportX }},{{ c.viewportY }})
                    </div>
                    <div v-for="m in r.validation.missed" :key="'m'+m.viewportX+m.viewportY" class="text-red-400">
                      ✗ 미식별: ({{ m.viewportX }},{{ m.viewportY }}) {{ m.emoji }}
                    </div>
                    <div v-for="w in r.validation.wrong" :key="'w'+w.viewportX+w.viewportY" class="text-orange-400">
                      ✗ 오답: {{ w.colorName }} {{ w.name }}({{ w.emoji }}) at ({{ w.viewportX }},{{ w.viewportY }})
                    </div>
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
