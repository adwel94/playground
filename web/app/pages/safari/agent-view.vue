<script setup>
const route = useRoute()
const sessionId = route.query.sessionId || ''

const AGENT_VIEW_SIZE = 10
const AGENT_VIEW_RADIUS = 5
const GRID_SIZE = 50
const TILE_SIZE = 48 // 48px per tile = 480x480 canvas
const CANVAS_PX = AGENT_VIEW_SIZE * TILE_SIZE // 480

const canvasRef = ref(null)
const player = ref({ x: 25, y: 25 })
const animals = ref([])
const obstacles = ref([])
const isConnected = ref(false)

let ws = null

function drawAgentView() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  canvas.width = CANVAS_PX
  canvas.height = CANVAS_PX

  const startX = Math.max(0, Math.min(player.value.x - AGENT_VIEW_RADIUS, GRID_SIZE - AGENT_VIEW_SIZE))
  const startY = Math.max(0, Math.min(player.value.y - AGENT_VIEW_RADIUS, GRID_SIZE - AGENT_VIEW_SIZE))
  const endX = startX + AGENT_VIEW_SIZE
  const endY = startY + AGENT_VIEW_SIZE

  const T = TILE_SIZE

  // Background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX)

  // Grid lines
  ctx.strokeStyle = '#f0f0f0'
  for (let i = 0; i <= AGENT_VIEW_SIZE; i++) {
    ctx.beginPath(); ctx.moveTo(i * T, 0); ctx.lineTo(i * T, CANVAS_PX); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, i * T); ctx.lineTo(CANVAS_PX, i * T); ctx.stroke()
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${T * 0.8}px serif`

  // Obstacles in view
  obstacles.value.forEach(o => {
    if (o.x >= startX && o.x < endX && o.y >= startY && o.y < endY) {
      const lx = (o.x - startX) * T + T / 2
      const ly = (o.y - startY) * T + T / 2
      ctx.fillText(o.emoji, lx, ly)
    }
  })

  // Animals in view
  animals.value.forEach(a => {
    if (a.x >= startX && a.x < endX && a.y >= startY && a.y < endY) {
      const lx = (a.x - startX) * T
      const ly = (a.y - startY) * T
      ctx.fillStyle = a.bgColor
      ctx.fillRect(lx, ly, T, T)
      ctx.fillStyle = 'black'
      ctx.font = `${T * 0.8}px serif`
      ctx.fillText(a.emoji, lx + T / 2, ly + T / 2)
    }
  })

  // Player
  const plx = (player.value.x - startX) * T
  const ply = (player.value.y - startY) * T
  ctx.fillStyle = '#3B82F6'
  ctx.beginPath()
  ctx.arc(plx + T / 2, ply + T / 2, T / 2 - 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'white'
  ctx.font = `bold ${T * 0.6}px sans-serif`
  ctx.fillText('P', plx + T / 2, ply + T / 2)
}

let flashTimer = null

function flashBlocked(direction) {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  if (flashTimer) clearTimeout(flashTimer)

  const T = TILE_SIZE
  const startX = Math.max(0, Math.min(player.value.x - AGENT_VIEW_RADIUS, GRID_SIZE - AGENT_VIEW_SIZE))
  const startY = Math.max(0, Math.min(player.value.y - AGENT_VIEW_RADIUS, GRID_SIZE - AGENT_VIEW_SIZE))

  const plx = (player.value.x - startX) * T
  const ply = (player.value.y - startY) * T

  const offsets = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] }
  const [odx, ody] = offsets[direction] || [0, 0]
  const bx = (player.value.x + odx - startX) * T
  const by = (player.value.y + ody - startY) * T

  let count = 0
  const flash = () => {
    if (count >= 4) {
      drawAgentView()
      return
    }
    if (count % 2 === 0) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.45)'
      ctx.fillRect(bx, by, T, T)
      ctx.fillStyle = 'rgba(239, 68, 68, 0.3)'
      ctx.beginPath()
      ctx.arc(plx + T / 2, ply + T / 2, T / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      drawAgentView()
    }
    count++
    flashTimer = setTimeout(flash, 120)
  }
  flash()
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${protocol}//${location.host}/_ws/safari?sessionId=${sessionId}`)

  ws.onopen = () => {
    isConnected.value = true
  }

  ws.onclose = () => {
    isConnected.value = false
    setTimeout(connect, 2000)
  }

  ws.onmessage = (event) => {
    let msg
    try {
      msg = JSON.parse(event.data)
    } catch {
      return
    }

    if (msg.type === 'gameState') {
      player.value = msg.state.player
      animals.value = msg.state.animals
      obstacles.value = msg.state.obstacles
      nextTick(drawAgentView)
    } else if (msg.type === 'playerMoved') {
      player.value = msg.pos
      if (msg.blocked && msg.direction) {
        nextTick(() => flashBlocked(msg.direction))
      } else {
        nextTick(drawAgentView)
      }
    } else if (msg.type === 'animalCaught') {
      if (msg.success && msg.position) {
        animals.value = animals.value.filter(
          a => !(a.x === msg.position.x && a.y === msg.position.y)
        )
        nextTick(drawAgentView)
      }
    }
  }
}

onMounted(() => {
  connect()
})

onUnmounted(() => {
  if (ws) ws.close()
})
</script>

<template>
  <div style="margin: 0; padding: 0; overflow: hidden; width: 480px; height: 480px;">
    <canvas ref="canvasRef" width="480" height="480" style="display: block;" />
  </div>
</template>
