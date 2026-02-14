import { writeFile, appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SYSTEM_PROMPT } from './tools'
import type { ToolCall } from './nodes'

type PendingTurn = {
  step: number
  contextText: string
  imageDataUrl: string
  toolCalls: ToolCall[]
}

const DATA_DIR = join(process.cwd(), '..', 'data', 'safari-dataset')
const IMAGES_DIR = join(DATA_DIR, 'images')
const DATASET_FILE = join(DATA_DIR, 'dataset.jsonl')

export class DataCollector {
  readonly episodeId: string
  readonly mission: string
  private pendingTurn: PendingTurn | null = null
  private rawRequest: any = null
  private rawResponse: any = null

  constructor(mission: string) {
    this.episodeId = randomUUID().slice(0, 8)
    this.mission = mission
  }

  recordAgentTurn(step: number, contextText: string, imageDataUrl: string, toolCalls: ToolCall[]) {
    this.pendingTurn = { step, contextText, imageDataUrl, toolCalls }
  }

  recordRawPayload(phase: 'request' | 'response', data: any) {
    if (phase === 'request') this.rawRequest = data
    else this.rawResponse = data
  }

  private extractThought(): string | null {
    const parts = this.rawResponse?.raw?.candidates?.[0]?.content?.parts
    if (!Array.isArray(parts)) return null
    const thoughts = parts.filter((p: any) => p.thought === true).map((p: any) => p.text)
    return thoughts.length > 0 ? thoughts.join('\n') : null
  }

  async saveTurn(toolResults: { name: string; result: Record<string, any> }[]) {
    if (!this.pendingTurn) return

    const turn = this.pendingTurn
    this.pendingTurn = null

    await mkdir(IMAGES_DIR, { recursive: true })

    // Save image as PNG
    const imageFileName = `ep_${this.episodeId}_turn_${String(turn.step).padStart(3, '0')}.png`
    const imageRelPath = `images/${imageFileName}`
    const imageAbsPath = join(IMAGES_DIR, imageFileName)

    if (turn.imageDataUrl) {
      const base64 = turn.imageDataUrl.replace(/^data:image\/\w+;base64,/, '')
      await writeFile(imageAbsPath, Buffer.from(base64, 'base64'))
    }

    const thoughtText = this.extractThought()

    const entry = {
      episode_id: this.episodeId,
      mission: this.mission,
      turn: turn.step,
      system_prompt: SYSTEM_PROMPT,
      context_text: turn.contextText,
      image_file: imageRelPath,
      tool_calls: turn.toolCalls.map(c => ({ name: c.name, args: c.args })),
      tool_results: toolResults.map(r => ({ name: r.name, result: r.result })),
      thought_text: thoughtText,
      raw_request: this.rawRequest,
      raw_response: this.rawResponse,
    }
    this.rawRequest = null
    this.rawResponse = null

    await appendFile(DATASET_FILE, JSON.stringify(entry) + '\n', 'utf-8')
    console.log(`[DataCollector] Saved turn ${turn.step} for episode ${this.episodeId}`)
  }
}
