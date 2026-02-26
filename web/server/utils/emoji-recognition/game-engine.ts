import {
  type Animal,
  type Obstacle,
  GRID_SIZE,
  AGENT_VIEW_SIZE,
  AGENT_VIEW_RADIUS,
} from '../safari/game-engine'
import {
  EMOJI_REC_ANIMAL_EMOJIS,
  EMOJI_REC_BG_COLORS,
  EMOJI_REC_ANIMAL_NAMES_KO,
  EMOJI_REC_COLOR_NAMES_KO,
} from './constants'

// GridState (safari exports GameState, we define our own to avoid name clash)
type GridState = {
  player: { x: number; y: number }
  animals: Animal[]
  obstacles: Obstacle[]
}

export type VisibleAnimal = Animal & { viewportX: number; viewportY: number }

export type IdentifiedAnimal = {
  emoji: string
  name: string       // 한국어 이름
  bgColor: string
  colorName: string  // 한국어 색상명
  viewportX: number
  viewportY: number
}

export type ValidationResult = {
  correct: IdentifiedAnimal[]
  missed: VisibleAnimal[]
  wrong: IdentifiedAnimal[]
  accuracy: number
}

export type RoundState = {
  roundNumber: number
  gridState: GridState
  viewportAnimals: VisibleAnimal[]
}

// 64가지 조합 (8동물 x 8색상) 생성
function allCombinations(): Array<{ emoji: string; bgColor: string }> {
  const combos: Array<{ emoji: string; bgColor: string }> = []
  for (const emoji of EMOJI_REC_ANIMAL_EMOJIS) {
    for (const bgColor of EMOJI_REC_BG_COLORS) {
      combos.push({ emoji, bgColor })
    }
  }
  return combos
}

function shuffle<T>(arr: T[]): T[] {
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j]!, result[i]!]
  }
  return result
}

export function createEmojiRecognitionEngine() {
  let animals: Animal[] = []
  let obstacles: Obstacle[] = []
  let player = { x: 25, y: 25 }
  let roundNumber = 0

  // 64조합 순환 큐 — 균등 커버리지 보장
  let comboQueue: Array<{ emoji: string; bgColor: string }> = []

  function nextCombos(count: number): Array<{ emoji: string; bgColor: string }> {
    const result: Array<{ emoji: string; bgColor: string }> = []
    for (let i = 0; i < count; i++) {
      if (comboQueue.length === 0) {
        comboQueue = shuffle(allCombinations())
      }
      result.push(comboQueue.pop()!)
    }
    return result
  }

  function generateRound(options?: {
    animalCount?: number
    obstacleCount?: number
    requiredAnimals?: Array<{ emoji: string; bgColor: string }>
  }): RoundState {
    roundNumber++

    // 플레이어 위치 랜덤화 (뷰포트가 완전히 그리드 안에 들어오도록)
    player = {
      x: AGENT_VIEW_RADIUS + Math.floor(Math.random() * (GRID_SIZE - AGENT_VIEW_SIZE)),
      y: AGENT_VIEW_RADIUS + Math.floor(Math.random() * (GRID_SIZE - AGENT_VIEW_SIZE)),
    }

    const startX = Math.max(0, Math.min(player.x - AGENT_VIEW_RADIUS, GRID_SIZE - AGENT_VIEW_SIZE))
    const startY = Math.max(0, Math.min(player.y - AGENT_VIEW_RADIUS, GRID_SIZE - AGENT_VIEW_SIZE))

    const occupied = new Set<string>()
    occupied.add(`${player.x},${player.y}`)

    // 뷰포트 내 빈 위치 생성
    const viewportFreePos = (): { x: number; y: number } | null => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const x = startX + Math.floor(Math.random() * AGENT_VIEW_SIZE)
        const y = startY + Math.floor(Math.random() * AGENT_VIEW_SIZE)
        const key = `${x},${y}`
        if (!occupied.has(key)) {
          occupied.add(key)
          return { x, y }
        }
      }
      return null
    }

    // 장애물 배치 (뷰포트 내)
    const obstacleCount = options?.obstacleCount ?? (5 + Math.floor(Math.random() * 11)) // 5~15
    obstacles = []
    for (let i = 0; i < obstacleCount; i++) {
      const pos = viewportFreePos()
      if (pos) obstacles.push({ ...pos, emoji: '🌲' })
    }

    // 동물 배치 (뷰포트 내)
    const animalCount = options?.animalCount ?? (2 + Math.floor(Math.random() * 3)) // 2~4
    const required = options?.requiredAnimals ?? []
    const combosNeeded = Math.max(0, animalCount - required.length)
    const combos = [...required, ...nextCombos(combosNeeded)]

    animals = []
    for (const combo of combos) {
      const pos = viewportFreePos()
      if (pos) {
        animals.push({ ...pos, emoji: combo.emoji, bgColor: combo.bgColor })
      }
    }

    return {
      roundNumber,
      gridState: getState(),
      viewportAnimals: getVisibleAnimals(),
    }
  }

  function getVisibleAnimals(): VisibleAnimal[] {
    const startX = Math.max(0, Math.min(player.x - AGENT_VIEW_RADIUS, GRID_SIZE - AGENT_VIEW_SIZE))
    const startY = Math.max(0, Math.min(player.y - AGENT_VIEW_RADIUS, GRID_SIZE - AGENT_VIEW_SIZE))
    const endX = startX + AGENT_VIEW_SIZE
    const endY = startY + AGENT_VIEW_SIZE

    return animals
      .filter(a => a.x >= startX && a.x < endX && a.y >= startY && a.y < endY)
      .map(a => ({
        ...a,
        viewportX: a.x - startX,
        viewportY: a.y - startY,
      }))
  }

  function validateAnswer(answer: IdentifiedAnimal[]): ValidationResult {
    const visible = getVisibleAnimals()
    const correct: IdentifiedAnimal[] = []
    const wrong: IdentifiedAnimal[] = []
    const matchedIndices = new Set<number>()

    for (const a of answer) {
      // 이모지 + 색상이 일치하는 동물 찾기 (위치는 ±1 허용)
      const idx = visible.findIndex((v, i) =>
        !matchedIndices.has(i)
        && v.emoji === a.emoji
        && v.bgColor === a.bgColor
        && Math.abs(v.viewportX - a.viewportX) <= 1
        && Math.abs(v.viewportY - a.viewportY) <= 1,
      )
      if (idx >= 0) {
        matchedIndices.add(idx)
        correct.push(a)
      } else {
        wrong.push(a)
      }
    }

    const missed = visible.filter((_, i) => !matchedIndices.has(i))
    const total = visible.length
    const accuracy = total > 0 ? correct.length / total : 1

    return { correct, missed, wrong, accuracy }
  }

  function getState(): GridState {
    return {
      player: { ...player },
      animals: animals.map(a => ({ ...a })),
      obstacles: obstacles.map(o => ({ ...o })),
    }
  }

  function getRoundNumber() {
    return roundNumber
  }

  function getAnswerText(): string {
    const visible = getVisibleAnimals()
    return visible.map((a) => {
      const name = EMOJI_REC_ANIMAL_NAMES_KO[a.emoji] ?? a.emoji
      const color = EMOJI_REC_COLOR_NAMES_KO[a.bgColor] ?? a.bgColor
      return `${color} ${name}(${a.emoji}) at (${a.viewportX},${a.viewportY})`
    }).join('\n')
  }

  return {
    generateRound,
    getVisibleAnimals,
    validateAnswer,
    getState,
    getRoundNumber,
    getAnswerText,
  }
}

export type EmojiRecognitionEngine = ReturnType<typeof createEmojiRecognitionEngine>
