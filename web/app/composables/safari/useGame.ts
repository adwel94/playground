import { ref } from 'vue'

export const useGame = (canvasRef: Ref<HTMLCanvasElement | null>) => {
  const GRID_SIZE = 50
  const TILE_SIZE = 30
  const AGENT_VIEW_SIZE = 10
  const AGENT_VIEW_RADIUS = 5
  const AGENT_VIEW_PX = AGENT_VIEW_SIZE * TILE_SIZE // 160px

  const hoverCoord = ref<{ x: number; y: number } | null>(null)

  // Draw the full 50x50 map with externally provided state
  const draw = (
    player: { x: number; y: number },
    animals: any[],
    obstacles: any[],
  ) => {
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

    obstacles.forEach(o => {
      ctx.fillText(o.emoji, o.x * TILE_SIZE + TILE_SIZE / 2, o.y * TILE_SIZE + TILE_SIZE / 2)
    })

    animals.forEach(a => {
      ctx.fillStyle = a.bgColor
      ctx.fillRect(a.x * TILE_SIZE, a.y * TILE_SIZE, TILE_SIZE, TILE_SIZE)
      ctx.fillStyle = 'black'
      ctx.fillText(a.emoji, a.x * TILE_SIZE + TILE_SIZE / 2, a.y * TILE_SIZE + TILE_SIZE / 2)
    })

    const px = player.x * TILE_SIZE
    const py = player.y * TILE_SIZE
    ctx.fillStyle = '#3B82F6'
    ctx.beginPath(); ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE / 2 - 2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'white'
    ctx.font = `bold ${TILE_SIZE * 0.6}px sans-serif`
    ctx.fillText('P', px + TILE_SIZE / 2, py + TILE_SIZE / 2)

    // Agent view border (blue translucent rectangle)
    const startX = Math.max(0, Math.min(player.x - AGENT_VIEW_RADIUS, GRID_SIZE - AGENT_VIEW_SIZE))
    const startY = Math.max(0, Math.min(player.y - AGENT_VIEW_RADIUS, GRID_SIZE - AGENT_VIEW_SIZE))
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)'
    ctx.lineWidth = 2
    ctx.strokeRect(startX * TILE_SIZE, startY * TILE_SIZE, AGENT_VIEW_PX, AGENT_VIEW_PX)
    ctx.fillStyle = 'rgba(59, 130, 246, 0.05)'
    ctx.fillRect(startX * TILE_SIZE, startY * TILE_SIZE, AGENT_VIEW_PX, AGENT_VIEW_PX)
  }

  let flashTimer: ReturnType<typeof setTimeout> | null = null

  const flashBlocked = (
    direction: string,
    player: { x: number; y: number },
    animals: any[],
    obstacles: any[],
  ) => {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (flashTimer) clearTimeout(flashTimer)

    const px = player.x * TILE_SIZE
    const py = player.y * TILE_SIZE

    const offsets: Record<string, [number, number]> = {
      UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0],
    }
    const [odx, ody] = offsets[direction] || [0, 0]
    const bx = (player.x + odx) * TILE_SIZE
    const by = (player.y + ody) * TILE_SIZE

    let count = 0
    const flash = () => {
      if (count >= 4) {
        draw(player, animals, obstacles)
        return
      }
      if (count % 2 === 0) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.45)'
        ctx.fillRect(bx, by, TILE_SIZE, TILE_SIZE)
        ctx.fillStyle = 'rgba(239, 68, 68, 0.3)'
        ctx.beginPath()
        ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE / 2 + 2, 0, Math.PI * 2)
        ctx.fill()
      } else {
        draw(player, animals, obstacles)
      }
      count++
      flashTimer = setTimeout(flash, 120)
    }
    flash()
  }

  const handleCanvasMouseMove = (e: MouseEvent) => {
    const canvas = canvasRef.value
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const gx = Math.floor((e.clientX - rect.left) * scaleX / TILE_SIZE)
    const gy = Math.floor((e.clientY - rect.top) * scaleY / TILE_SIZE)
    if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE) {
      hoverCoord.value = { x: gx, y: gy }
    } else {
      hoverCoord.value = null
    }
  }

  const handleCanvasMouseLeave = () => {
    hoverCoord.value = null
  }

  return {
    hoverCoord,
    draw,
    flashBlocked,
    handleCanvasMouseMove,
    handleCanvasMouseLeave,
  }
}
