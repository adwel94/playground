import { writeFile, appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { EMOJI_REC_ANIMAL_NAMES_KO, EMOJI_REC_COLOR_NAMES_KO } from './constants'
import type { VisibleAnimal } from './game-engine'

const DATA_DIR = join(process.cwd(), '..', 'data', 'emoji-recognition')
const IMAGES_DIR = join(DATA_DIR, 'images')
const DATASET_FILE = join(DATA_DIR, 'dataset.jsonl')

export const EMOJI_REC_SYSTEM_PROMPT = `당신은 이모티콘 인식 전문가입니다.
10x10 뷰포트 이미지를 보고, 보이는 모든 동물을 식별해야 합니다.

## 뷰포트 설명
- 10x10 격자 (좌표 0~9)
- 각 타일은 48x48 픽셀
- 동물: 이모지 + 색상 배경 (예: 빨간 배경 위 🐯)
- 나무: 🌲 (배경 없음)
- 플레이어: 파란 원 안 "P"

## 식별 대상 동물
🐯 호랑이, 🐘 코끼리, 🦒 기린, 🐒 원숭이, 🦓 얼룩말, 🦁 사자, 🐷 돼지, 🐨 코알라

## 식별 대상 배경색
빨간색(#FF0000), 초록색(#00FF00), 파란색(#0000FF), 노란색(#FFFF00),
자주색(#FF00FF), 청록색(#00FFFF), 주황색(#FFA500), 보라색(#800080)

## 응답 형식
update_notepad 도구를 사용하여 관찰 결과를 기록하세요.

[관찰]
- (x좌표,y좌표) 색상이름 동물이름(이모지)
예시:
- (3,7) 빨간색 호랑이(🐯)
- (8,2) 노란색 원숭이(🐒)

정확한 좌표, 색상, 동물 종류를 모두 식별해야 합니다.`

export class EmojiRecognitionCollector {
  readonly sessionId: string
  private entries: any[] = []

  constructor() {
    this.sessionId = randomUUID().slice(0, 8)
  }

  async recordRound(data: {
    roundNumber: number
    screenshot: string         // base64 data URL
    visibleAnimals: VisibleAnimal[]
    llmResponse: string
    thought: string | null
    isCorrect: boolean
  }) {
    await mkdir(IMAGES_DIR, { recursive: true })

    // Save image
    const imageFileName = `emoji_rec_${this.sessionId}_round_${String(data.roundNumber).padStart(3, '0')}.png`
    const imageRelPath = `images/${imageFileName}`
    const imageAbsPath = join(IMAGES_DIR, imageFileName)

    if (data.screenshot) {
      const base64 = data.screenshot.replace(/^data:image\/\w+;base64,/, '')
      await writeFile(imageAbsPath, Buffer.from(base64, 'base64'))
    }

    // 정답 텍스트 생성
    const answerText = data.visibleAnimals.map((a) => {
      const name = EMOJI_REC_ANIMAL_NAMES_KO[a.emoji] ?? a.emoji
      const color = EMOJI_REC_COLOR_NAMES_KO[a.bgColor] ?? a.bgColor
      return `(${a.viewportX},${a.viewportY}) ${color} ${name}(${a.emoji})`
    }).join('\n')

    const contextText = `이 이미지에서 보이는 동물을 모두 식별해주세요.
각 동물의 위치(x,y), 배경색, 동물 종류를 정확히 기록해주세요.`

    const entry = {
      episode_id: `emoji-rec-${this.sessionId}`,
      round: data.roundNumber,
      system_prompt: EMOJI_REC_SYSTEM_PROMPT,
      context_text: contextText,
      image_file: imageRelPath,
      tool_calls: [{
        name: 'update_notepad',
        args: { content: data.llmResponse },
      }],
      tool_results: [{
        name: 'update_notepad',
        result: { status: 'updated' },
      }],
      thought_text: data.thought,
      answer_text: answerText,
      visible_animals: data.visibleAnimals.map(a => ({
        emoji: a.emoji,
        bgColor: a.bgColor,
        name: EMOJI_REC_ANIMAL_NAMES_KO[a.emoji] ?? a.emoji,
        colorName: EMOJI_REC_COLOR_NAMES_KO[a.bgColor] ?? a.bgColor,
        viewportX: a.viewportX,
        viewportY: a.viewportY,
      })),
      is_correct: data.isCorrect,
    }

    this.entries.push(entry)
    await appendFile(DATASET_FILE, JSON.stringify(entry) + '\n', 'utf-8')
    console.log(`[EmojiRecCollector] Saved round ${data.roundNumber} (session ${this.sessionId})`)
  }

  getEntryCount() {
    return this.entries.length
  }

  getDataDir() {
    return DATA_DIR
  }
}
