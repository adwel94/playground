import { ref, onMounted, onUnmounted } from 'vue'

export const useAgentWebSocket = (gameId: string) => {
  const config = useRuntimeConfig()
  const ws = ref<WebSocket | null>(null)
  const isConnected = ref(false)
  const agentLogs = ref<{ time: string; msg: string }[]>([])
  const isAgentProcessing = ref(false)

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    agentLogs.value.unshift({ time, msg })
    if (agentLogs.value.length > 50) agentLogs.value.pop()
  }

  const connect = () => {
    const baseUrl = config.public.wsUrl.replace(/\/$/, "")
    ws.value = new WebSocket(`${baseUrl}/ws/${gameId}`)

    ws.value.onopen = () => {
      isConnected.value = true
      addLog("System: Connected to Agent backend.")
    }

    ws.value.onclose = () => {
      isConnected.value = false
      addLog("System: Disconnected. Retrying in 3s...")
      setTimeout(connect, 3000)
    }

    ws.value.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        // 이 메시지는 컴포넌트에서 직접 처리할 수 있도록 이벤트를 발생시키거나 콜백을 넘겨줄 수 있습니다.
        // 여기서는 메시지 객체를 반환하는 핸들러를 별도로 등록하게 하거나, 
        // 외부에서 onMessage 콜백을 주입받는 방식을 사용합니다.
      } catch (e) {
        console.error("Failed to parse WS message", e)
      }
    }
  }

  const sendMessage = (event: string, payload: any) => {
    if (ws.value && isConnected.value) {
      ws.value.send(JSON.stringify({ event, ...payload }))
    }
  }

  onMounted(() => {
    connect()
  })

  onUnmounted(() => {
    ws.value?.close()
  })

  return {
    ws,
    isConnected,
    agentLogs,
    isAgentProcessing,
    addLog,
    sendMessage
  }
}
