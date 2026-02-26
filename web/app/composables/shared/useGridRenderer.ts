import type { Ref } from 'vue'

type Animal = { x: number; y: number; emoji: string; bgColor: string }
type Obstacle = { x: number; y: number; emoji: string }

const AGENT_VIEW_SIZE = 10
const AGENT_VIEW_RADIUS = 5
const GRID_SIZE = 50

export function useGridRenderer(canvasRef: Ref<HTMLCanvasElement | null>) {
  function drawViewport(state: {
    player: { x: number; y: number }
    animals: Animal[]
    obstacles: Obstacle[]
    tileSize?: number
  }) {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const T = state.tileSize ?? 48
    const CANVAS_PX = AGENT_VIEW_SIZE * T

    canvas.width = CANVAS_PX
    canvas.height = CANVAS_PX

    const startX = Math.max(0, Math.min(state.player.x - AGENT_VIEW_RADIUS, GRID_SIZE - AGENT_VIEW_SIZE))
    const startY = Math.max(0, Math.min(state.player.y - AGENT_VIEW_RADIUS, GRID_SIZE - AGENT_VIEW_SIZE))
    const endX = startX + AGENT_VIEW_SIZE
    const endY = startY + AGENT_VIEW_SIZE

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
    state.obstacles.forEach((o) => {
      if (o.x >= startX && o.x < endX && o.y >= startY && o.y < endY) {
        const lx = (o.x - startX) * T + T / 2
        const ly = (o.y - startY) * T + T / 2
        ctx.fillText(o.emoji, lx, ly)
      }
    })

    // Animals in view
    state.animals.forEach((a) => {
      if (a.x >= startX && a.x < endX && a.y >= startY && a.y < endY) {
        const lx = (a.x - startX) * T
        const ly = (a.y - startY) * T
        ctx.fillStyle = a.bgColor
        ctx.fillRect(lx, ly, T, T)
        ctx.fillStyle = 'black'
        ctx.font = `${T * 0.8}px serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(a.emoji, lx + T / 2, ly + T / 2)
      }
    })

    // Player
    const plx = (state.player.x - startX) * T
    const ply = (state.player.y - startY) * T
    ctx.fillStyle = '#3B82F6'
    ctx.beginPath()
    ctx.arc(plx + T / 2, ply + T / 2, T / 2 - 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'white'
    ctx.font = `bold ${T * 0.6}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('P', plx + T / 2, ply + T / 2)
  }

  return { drawViewport }
}
