import { ref, onMounted, onUnmounted } from 'vue'

type AgentLog = { time: string; msg: string; logType: string; detail?: string }
type ChatMessage = { role: string; content: string; image?: string; time: string }
type DebugEntry = { step: number; request?: any; response?: any; toolResults?: any[]; time: string }

function nowTime() {
  return new Date().toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function useWebSocket(sessionId: string) {
  const player = ref({ x: 25, y: 25 })
  const animals = ref<any[]>([])
  const obstacles = ref<any[]>([])
  const agentLogs = ref<AgentLog[]>([])
  const chatMessages = ref<ChatMessage[]>([])
  const isAgentProcessing = ref(false)
  const isConnected = ref(false)
  const lastBlocked = ref<{ direction: string; pos: { x: number; y: number } } | null>(null)
  const isStopping = ref(false)
  const debugEntries = ref<DebugEntry[]>([])
  const isAutoPlaying = ref(false)
  const autoProgress = ref({ current: 0, total: 0, mission: '' })

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function addLog(msg: string, logType = 'system', detail?: string) {
    agentLogs.value.push({ time: nowTime(), msg, logType, detail })
    if (agentLogs.value.length > 300) agentLogs.value.shift()
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(`${protocol}//${location.host}/_ws/safari?sessionId=${sessionId}`)

    ws.onopen = () => {
      isConnected.value = true
      addLog('WebSocket 연결됨', 'system')
    }

    ws.onclose = () => {
      isConnected.value = false
      addLog('WebSocket 연결 끊김', 'system')
      scheduleReconnect()
    }

    ws.onerror = () => {
      // onclose will fire after this
    }

    ws.onmessage = (event) => {
      let msg: any
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }

      switch (msg.type) {
        case 'gameState':
          player.value = msg.state.player
          animals.value = msg.state.animals
          obstacles.value = msg.state.obstacles
          break

        case 'playerMoved':
          if (msg.blocked && msg.direction) {
            lastBlocked.value = { direction: msg.direction, pos: { ...player.value } }
          }
          player.value = msg.pos
          break

        case 'animalCaught':
          if (msg.success && msg.position) {
            animals.value = animals.value.filter(
              a => !(a.x === msg.position.x && a.y === msg.position.y)
            )
          }
          break

        case 'agentLog':
          agentLogs.value.push({ time: nowTime(), msg: msg.msg, logType: msg.logType, detail: msg.detail })
          if (agentLogs.value.length > 300) agentLogs.value.shift()
          if (msg.logType === 'system') {
            chatMessages.value.push({ role: 'system', content: msg.msg, time: nowTime() })
            if (chatMessages.value.length > 500) chatMessages.value.shift()
          }
          break

        case 'agentChat':
          chatMessages.value.push({ role: msg.role, content: msg.content, image: msg.image, time: nowTime() })
          if (chatMessages.value.length > 500) chatMessages.value.shift()
          break

        case 'agentDebug': {
          const { phase, data } = msg
          if (phase === 'request') {
            // Step info — create new entry
            debugEntries.value.push({ step: data.step, time: nowTime() })
          } else if (phase === 'request-payload') {
            // Raw API request payload — attach to last entry
            const last = debugEntries.value[debugEntries.value.length - 1]
            if (last) last.request = data
          } else if (phase === 'response-payload') {
            // Raw API response — attach to last entry
            const last = debugEntries.value[debugEntries.value.length - 1]
            if (last) last.response = data
          } else if (phase === 'tool-results') {
            // Tool execution results — attach to last entry
            const last = debugEntries.value[debugEntries.value.length - 1]
            if (last) last.toolResults = data.results
          }
          if (debugEntries.value.length > 200) debugEntries.value.shift()
          break
        }

        case 'agentStatus':
          isAgentProcessing.value = msg.status === 'running'
          if (msg.status !== 'running') isStopping.value = false
          break

        case 'autoProgress':
          isAutoPlaying.value = true
          autoProgress.value = { current: msg.current, total: msg.total, mission: msg.mission || '' }
          break

        case 'autoComplete':
          isAutoPlaying.value = false
          addLog(`자동 플레이 완료: ${msg.completed}/${msg.total} 에피소드`, 'system')
          break
      }
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, 2000)
  }

  function send(data: any) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data))
    }
  }

  function sendInit() {
    send({ type: 'init' })
  }

  function sendMission(mission: string, modelId?: string) {
    chatMessages.value = []
    debugEntries.value = []
    addLog(`유저: ${mission}`, 'user')
    send({
      type: 'mission',
      mission,
      modelId: modelId || 'gemini',
    })
  }

  function sendStop() {
    send({ type: 'stop' })
    isStopping.value = true
    addLog('에이전트 중단 요청 (현재 턴 완료 후 종료됩니다)', 'user')
  }

  function sendMove(direction: string, steps = 1) {
    send({ type: 'move', direction, steps })
  }

  function sendCatch() {
    send({ type: 'catch' })
  }

  function sendStartAuto(rounds: number, modelId?: string) {
    chatMessages.value = []
    debugEntries.value = []
    addLog(`자동 플레이 시작: ${rounds} 에피소드`, 'user')
    send({ type: 'start-auto', rounds, modelId: modelId || 'gemini' })
  }

  function sendStopAuto() {
    send({ type: 'stop-auto' })
    addLog('자동 플레이 중단 요청', 'user')
  }

  function clearChat() {
    chatMessages.value = []
  }

  // Auto-connect on client only
  onMounted(() => connect())

  onUnmounted(() => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (ws) ws.close()
  })

  return {
    player,
    animals,
    obstacles,
    agentLogs,
    chatMessages,
    isAgentProcessing,
    isConnected,
    lastBlocked,
    isStopping,
    debugEntries,
    isAutoPlaying,
    autoProgress,
    addLog,
    clearChat,
    sendInit,
    sendMission,
    sendStop,
    sendMove,
    sendCatch,
    sendStartAuto,
    sendStopAuto,
    connect,
  }
}
