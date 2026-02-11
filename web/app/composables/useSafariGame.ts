import { ref } from 'vue'

export const useSafariGame = (canvasRef: Ref<HTMLCanvasElement | null>) => {
  const GRID_SIZE = 50
  const TILE_SIZE = 16
  const player = ref({ x: 25, y: 25 })
  const animals = ref<any[]>([])
  const obstacles = ref<any[]>([])

  const animalEmojis = ['🐯', '🐘', '🦒', '🐒', '🦓', '🦁', '🐷', '🐨']
  const colors = ['#FFADAD', '#FFD6A5', '#FDFFB6', '#CAFFBF', '#9BF6FF', '#A0C4FF', '#BDB2FF', '#FFC6FF']

  const initGame = () => {
    player.value = { x: Math.floor(GRID_SIZE / 2), y: Math.floor(GRID_SIZE / 2) }
    animals.value = Array.from({ length: 60 }, () => ({
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_SIZE),
      emoji: animalEmojis[Math.floor(Math.random() * animalEmojis.length)],
      bgColor: colors[Math.floor(Math.random() * colors.length)]
    }))
    obstacles.value = Array.from({ length: 300 }, () => ({
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_SIZE),
      emoji: '🌲'
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
  }

  const movePlayer = (dx: number, dy: number) => {
    const newX = player.value.x + dx
    const newY = player.value.y + dy
    if (newX >= 0 && newX < GRID_SIZE && newY >= 0 && newY < GRID_SIZE) {
      if (!obstacles.value.some(o => o.x === newX && o.y === newY)) {
        player.value.x = newX
        player.value.y = newY
        draw()
      }
    }
  }

  return {
    player,
    initGame,
    draw,
    movePlayer
  }
}
