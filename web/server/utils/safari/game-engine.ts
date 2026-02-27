export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'

export type Animal = {
  x: number
  y: number
  emoji: string
  bgColor: string
}

export type Obstacle = {
  x: number
  y: number
  emoji: string
}

export type MoveResult = {
  moved: boolean
  actualSteps: number
  blocked: boolean
  pos: { x: number; y: number }
}

export type CatchResult = {
  success: boolean
  animal?: { emoji: string; bgColor: string }
  position?: { x: number; y: number }
  reason?: string
}

export type GameState = {
  player: { x: number; y: number }
  animals: Animal[]
  obstacles: Obstacle[]
}

export type AgentViewState = {
  startX: number
  startY: number
  player: { x: number; y: number }
  animals: Animal[]
  obstacles: Obstacle[]
}

export const GRID_SIZE = 50
export const AGENT_VIEW_SIZE = 10
export const AGENT_VIEW_RADIUS = 5

const ANIMAL_EMOJIS = ['🐯', '🐘', '🦒', '🐒', '🦓', '🦁', '🐷', '🐨']
const COLORS = [
  '#FF0000', // Red
  '#00FF00', // Green
  '#0000FF', // Blue
  '#FFFF00', // Yellow
  '#FF00FF', // Magenta
  '#00FFFF', // Cyan
  '#FFA500', // Orange
  '#800080'  // Purple
]

const COLOR_NAME_KO: Record<string, string> = {
  '#FF0000': '빨간',
  '#00FF00': '초록',
  '#0000FF': '파란',
  '#FFFF00': '노란',
  '#FF00FF': '분홍',
  '#00FFFF': '하늘',
  '#FFA500': '주황',
  '#800080': '보라',
}

const ANIMAL_NAME_KO: Record<string, string> = {
  '🐯': '호랑이',
  '🐘': '코끼리',
  '🦒': '기린',
  '🐒': '원숭이',
  '🦓': '얼룩말',
  '🦁': '사자',
  '🐷': '돼지',
  '🐨': '코알라',
}

export function createGameEngine() {
  let player = { x: 25, y: 25 }
  let animals: Animal[] = []
  let obstacles: Obstacle[] = []

  function initGame() {
    player = { x: Math.floor(GRID_SIZE / 2), y: Math.floor(GRID_SIZE / 2) }

    const occupied = new Set<string>()
    occupied.add(`${player.x},${player.y}`)

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

    obstacles = Array.from({ length: 300 }, () => ({
      ...randomFreePos(),
      emoji: '🌲',
    }))

    animals = Array.from({ length: 60 }, () => ({
      ...randomFreePos(),
      emoji: ANIMAL_EMOJIS[Math.floor(Math.random() * ANIMAL_EMOJIS.length)]!,
      bgColor: COLORS[Math.floor(Math.random() * COLORS.length)]!,
    }))
  }

  function movePlayer(direction: Direction, steps: number): MoveResult {
    const deltas: Record<Direction, [number, number]> = {
      UP: [0, -1],
      DOWN: [0, 1],
      LEFT: [-1, 0],
      RIGHT: [1, 0],
    }
    const [dx, dy] = deltas[direction]
    let actualSteps = 0

    for (let i = 0; i < steps; i++) {
      const newX = player.x + dx
      const newY = player.y + dy
      if (newX < 0 || newX >= GRID_SIZE || newY < 0 || newY >= GRID_SIZE) break
      if (obstacles.some(o => o.x === newX && o.y === newY)) break
      if (animals.some(a => a.x === newX && a.y === newY)) break
      player.x = newX
      player.y = newY
      actualSteps++
    }

    return {
      moved: actualSteps > 0,
      actualSteps,
      blocked: actualSteps < steps,
      pos: { x: player.x, y: player.y },
    }
  }

  function catchAnimal(direction: Direction): CatchResult {
    const deltas: Record<Direction, [number, number]> = {
      UP: [0, -1],
      DOWN: [0, 1],
      LEFT: [-1, 0],
      RIGHT: [1, 0],
    }
    const [dx, dy] = deltas[direction]
    const targetX = player.x + dx
    const targetY = player.y + dy

    if (targetX < 0 || targetX >= GRID_SIZE || targetY < 0 || targetY >= GRID_SIZE) {
      return { success: false, reason: 'out_of_bounds' }
    }

    const idx = animals.findIndex(a => a.x === targetX && a.y === targetY)
    if (idx === -1) {
      return { success: false, reason: 'no_animal' }
    }

    const caught = animals[idx]!
    animals.splice(idx, 1)
    return {
      success: true,
      animal: { emoji: caught.emoji, bgColor: caught.bgColor },
      position: { x: targetX, y: targetY },
    }
  }

  function getState(): GameState {
    return {
      player: { ...player },
      animals: animals.map(a => ({ ...a })),
      obstacles: obstacles.map(o => ({ ...o })),
    }
  }

  function getAgentView(): AgentViewState {
    const startX = Math.max(0, Math.min(player.x - AGENT_VIEW_RADIUS, GRID_SIZE - AGENT_VIEW_SIZE))
    const startY = Math.max(0, Math.min(player.y - AGENT_VIEW_RADIUS, GRID_SIZE - AGENT_VIEW_SIZE))
    const endX = startX + AGENT_VIEW_SIZE
    const endY = startY + AGENT_VIEW_SIZE

    return {
      startX,
      startY,
      player: { x: player.x, y: player.y },
      animals: animals.filter(a => a.x >= startX && a.x < endX && a.y >= startY && a.y < endY),
      obstacles: obstacles.filter(o => o.x >= startX && o.x < endX && o.y >= startY && o.y < endY),
    }
  }

  function getPlayer() {
    return { ...player }
  }

  function generateRandomMission(): string {
    if (animals.length === 0) return '맵을 탐색해'

    // 동물 목록에서 1~3마리 랜덤 선택 (중복 없이)
    const count = Math.min(animals.length, Math.floor(Math.random() * 3) + 1)
    const shuffled = [...animals].sort(() => Math.random() - 0.5)
    const targets = shuffled.slice(0, count)

    const descriptions = targets.map(a => {
      const colorName = COLOR_NAME_KO[a.bgColor] || '색깔'
      const animalName = ANIMAL_NAME_KO[a.emoji] || '동물'
      return `${colorName} ${animalName}`
    })

    if (descriptions.length === 1) return `${descriptions[0]}을 찾아`
    return `${descriptions.join('와 ')}를 찾아`
  }

  // Initialize on creation
  initGame()

  return {
    initGame,
    movePlayer,
    catchAnimal,
    getState,
    getAgentView,
    getPlayer,
    generateRandomMission,
  }
}

export type GameEngine = ReturnType<typeof createGameEngine>
