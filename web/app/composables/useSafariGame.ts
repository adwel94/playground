import { ref } from 'vue'

export const useSafariGame = (canvasRef: Ref<HTMLCanvasElement | null>) => {
  const GRID_SIZE = 50
  const TILE_SIZE = 16
  const AGENT_VIEW_SIZE = 10
  const AGENT_VIEW_RADIUS = 5
  const AGENT_VIEW_PX = AGENT_VIEW_SIZE * TILE_SIZE // 160px

  const player = ref({ x: 25, y: 25 })
  const animals = ref<any[]>([])
  const obstacles = ref<any[]>([])

  const animalEmojis = ['🐯', '🐘', '🦒', '🐒', '🦓', '🦁', '🐷', '🐨']
  const colors = ['#FFADAD', '#FFD6A5', '#FDFFB6', '#CAFFBF', '#9BF6FF', '#A0C4FF', '#BDB2FF', '#FFC6FF']

  const initGame = () => {
    player.value = { x: Math.floor(GRID_SIZE / 2), y: Math.floor(GRID_SIZE / 2) }

    // 장애물/동물/플레이어가 겹치지 않도록 occupied set 사용
    const occupied = new Set<string>()
    const playerKey = `${player.value.x},${player.value.y}`
    occupied.add(playerKey)

    const randomFreePos = (): { x: number; y: number } => {
      let x: number, y: number, key: string
      do {
        x = Math.floor(Math.random() * GRID_SIZE)
        y = Math.floor(Math.random() * GRID_SIZE)
        key = `${x},${y}`
      } while (occupied.has(key))
      occupied.add(key)
      return { x, y }
    }

    obstacles.value = Array.from({ length: 300 }, () => ({
      ...randomFreePos(),
      emoji: '🌲'
    }))

    animals.value = Array.from({ length: 60 }, () => ({
      ...randomFreePos(),
      emoji: animalEmojis[Math.floor(Math.random() * animalEmojis.length)],
      bgColor: colors[Math.floor(Math.random() * colors.length)]
    }))
  }

  const draw = () => {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = GRID_SIZE * TILE_SIZE
    canvas.height = GRID_SIZE * TILE_SIZE

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Grid lines
    ctx.strokeStyle = '#f0f0f0'
    for (let i = 0; i <= GRID_SIZE; i++) {
      ctx.beginPath(); ctx.moveTo(i * TILE_SIZE, 0); ctx.lineTo(i * TILE_SIZE, canvas.height); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * TILE_SIZE); ctx.lineTo(canvas.width, i * TILE_SIZE); ctx.stroke()
    }

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${TILE_SIZE * 0.8}px serif`

    obstacles.value.forEach(o => {
      ctx.fillText(o.emoji, o.x * TILE_SIZE + TILE_SIZE / 2, o.y * TILE_SIZE + TILE_SIZE / 2)
    })

    animals.value.forEach(a => {
      ctx.fillStyle = a.bgColor
      ctx.fillRect(a.x * TILE_SIZE, a.y * TILE_SIZE, TILE_SIZE, TILE_SIZE)
      ctx.fillStyle = 'black'
      ctx.fillText(a.emoji, a.x * TILE_SIZE + TILE_SIZE / 2, a.y * TILE_SIZE + TILE_SIZE / 2)
    })

    const px = player.value.x * TILE_SIZE
    const py = player.value.y * TILE_SIZE
    ctx.fillStyle = '#3B82F6'
    ctx.beginPath(); ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE / 2 - 2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'white'
    ctx.font = `bold ${TILE_SIZE * 0.6}px sans-serif`
    ctx.fillText('P', px + TILE_SIZE / 2, py + TILE_SIZE / 2)

    // Agent view border (blue translucent rectangle)
    const startX = Math.max(0, Math.min(player.value.x - AGENT_VIEW_RADIUS, GRID_SIZE - AGENT_VIEW_SIZE))
    const startY = Math.max(0, Math.min(player.value.y - AGENT_VIEW_RADIUS, GRID_SIZE - AGENT_VIEW_SIZE))
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)'
    ctx.lineWidth = 2
    ctx.strokeRect(startX * TILE_SIZE, startY * TILE_SIZE, AGENT_VIEW_PX, AGENT_VIEW_PX)
    ctx.fillStyle = 'rgba(59, 130, 246, 0.05)'
    ctx.fillRect(startX * TILE_SIZE, startY * TILE_SIZE, AGENT_VIEW_PX, AGENT_VIEW_PX)
  }

  const movePlayer = (dx: number, dy: number): boolean => {
    const newX = player.value.x + dx
    const newY = player.value.y + dy
    if (newX >= 0 && newX < GRID_SIZE && newY >= 0 && newY < GRID_SIZE) {
      if (!obstacles.value.some(o => o.x === newX && o.y === newY)) {
        player.value.x = newX
        player.value.y = newY
        draw()
        return true
      }
    }
    return false
  }

  let flashTimer: ReturnType<typeof setTimeout> | null = null

  const flashBlocked = (direction: string) => {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (flashTimer) clearTimeout(flashTimer)

    const px = player.value.x * TILE_SIZE
    const py = player.value.y * TILE_SIZE

    // 막힌 방향의 타일 좌표
    const offsets: Record<string, [number, number]> = {
      UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0],
    }
    const [odx, ody] = offsets[direction] || [0, 0]
    const bx = (player.value.x + odx) * TILE_SIZE
    const by = (player.value.y + ody) * TILE_SIZE

    let count = 0
    const flash = () => {
      if (count >= 4) {
        draw()
        return
      }
      if (count % 2 === 0) {
        // 빨간 플래시: 막힌 방향 타일 + 플레이어
        ctx.fillStyle = 'rgba(239, 68, 68, 0.45)'
        ctx.fillRect(bx, by, TILE_SIZE, TILE_SIZE)
        ctx.fillStyle = 'rgba(239, 68, 68, 0.3)'
        ctx.beginPath()
        ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE / 2 + 2, 0, Math.PI * 2)
        ctx.fill()
      } else {
        draw()
      }
      count++
      flashTimer = setTimeout(flash, 120)
    }
    flash()
  }

  const captureAgentView = (): string | null => {
    const canvas = canvasRef.value
    if (!canvas) return null

    const startX = Math.max(0, Math.min(player.value.x - AGENT_VIEW_RADIUS, GRID_SIZE - AGENT_VIEW_SIZE))
    const startY = Math.max(0, Math.min(player.value.y - AGENT_VIEW_RADIUS, GRID_SIZE - AGENT_VIEW_SIZE))

    const offscreen = document.createElement('canvas')
    offscreen.width = AGENT_VIEW_PX
    offscreen.height = AGENT_VIEW_PX
    const offCtx = offscreen.getContext('2d')
    if (!offCtx) return null

    offCtx.drawImage(
      canvas,
      startX * TILE_SIZE, startY * TILE_SIZE, AGENT_VIEW_PX, AGENT_VIEW_PX,
      0, 0, AGENT_VIEW_PX, AGENT_VIEW_PX
    )
    return offscreen.toDataURL('image/png')
  }

  return {
    player,
    animals,
    initGame,
    draw,
    movePlayer,
    captureAgentView,
    flashBlocked,
  }
}
