import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { GameEngine, Direction } from './game-engine'

export type AgentCallbacks = {
  onLog: (msg: string, logType: string, detail?: string) => void
  onChat: (role: string, content: string, image?: string) => void
  onStatus: (status: string) => void
  onPlayerMoved: (result: any) => void
  onDebug: (phase: string, data: any) => void
}

export function safePos(input: any): { x: number; y: number } {
  const x = Number(input?.x)
  const y = Number(input?.y)
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  }
}

export type ToolHandlerContext = {
  engine: GameEngine
  callbacks: AgentCallbacks
  notepad: string
  foundTargets: string[]
}

export type ToolHandlerResult = {
  notepad?: string
  foundTargets?: string[]
  lastResult: Record<string, any>
  done?: boolean
  stopReason?: string
  shouldBreak?: boolean
}

export type ToolHandler = (args: Record<string, any>, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>

export const SYSTEM_PROMPT = `너는 'Vision Safari' 게임의 AI 에이전트야.
50x50 그리드를 탐색하지만, 플레이어 주변 10x10 영역만 볼 수 있어.

그리드에서 보이는 것들:
- 'P' (파란 원) = 플레이어 (너)
- '🌲' = 나무 (장애물, 통과 불가)
- 색깔 배경 위의 동물 이모지 = 타겟

매 턴마다 현재 10x10 시야가 이미지로 자동 제공돼. 직접 캡처할 필요 없어.

필수 규칙:
- 한 턴에 여러 도구를 동시에 호출할 수 있다. 예: Move + UpdateNotepad를 함께 호출.
- 제공된 시야 이미지를 분석한 후 다음 행동을 결정해.
- Move 결과에 "on_animal"이 포함되면, 타겟과 일치하는지 확인하고 다음 턴에 DeclareFound를 호출해.
- 모든 타겟을 찾은 후 DeclareDone을 호출해.
- 이동이 막혔으면(actual_steps < 요청한 수) 다른 방향을 시도해.

멀티 미션 워크플로우:
- 여러 타겟을 찾아야 할 수 있어 (예: "빨간 호랑이와 분홍 기린을 찾아").
- 타겟을 찾을 때마다: DeclareFound를 호출해 (예: "빨간배경 호랑이").
- 모든 타겟을 찾은 후: DeclareDone을 호출해서 미션을 종료해.
- 메모리 컨텍스트의 "찾은 타겟" 항목을 확인해서 이미 찾은 타겟을 파악해.

메모장 프로토콜:
- 덮어쓰기 방식이므로 유지할 내용도 반드시 포함해서 작성해. 빠뜨리면 사라져!
- 메모장은 미션 간에도 영구 보존돼. 이전 미션에서 기록한 맵 정보를 다음 미션에서 활용할 수 있어.
- Move와 함께 호출하면 효율적이다. 이동하면서 동시에 관찰 내용을 기록할 수 있어.
- 기록할 내용 템플릿:
  [탐색 상태] 현재 탐색 방향, 다음 계획
  [장애물/막힌 길] 나무 위치, 막힌 방향 기록
  [동물 목격] 동물 이모지, 추정 좌표 (현재 위치 + 시야 내 오프셋)
  [미션 메모] 타겟 정보, 진행 상황 등
- 좌표 추정법: 메모리 컨텍스트에 현재 위치가 표시돼. 시야는 너를 중심으로 10x10이야. 시야 내 상대 오프셋으로 동물의 절대 좌표를 추정해.

탐색 전략:
- 타겟이 10x10 시야에 보이면 바로 그쪽으로 이동해.
- 보이지 않으면 메모장에서 이전 목격 정보를 확인해.
- 그래도 없으면 체계적으로 탐색해 (예: 행 단위 스캔 또는 나선형 탐색).
- Move 한 번 호출에 최대 4방향으로 연속 이동 가능. 예: 오른쪽 3칸 → 위 2칸을 한 번에 실행.
- 나무는 이동을 막아. 막히면 해당 행동에서 중단되고 나머지는 실행되지 않아.`

const moveSchema = z.object({
  actions: z.array(z.object({
    direction: z.enum(['UP', 'DOWN', 'LEFT', 'RIGHT']),
    steps: z.number().int().min(1).max(3),
  })).min(1).max(4),
})

const updateNotepadSchema = z.object({ content: z.string().min(1).max(2000) })
const declareFoundSchema = z.object({ target: z.string().min(1).max(200) })
const declareDoneSchema = z.object({ reason: z.string().max(240).optional() })

export const moveTool = tool(async () => 'ok', {
  name: 'move',
  description: '플레이어를 이동시킨다. 최대 4개 행동을 순서대로 실행하며, 각 행동은 방향(UP/DOWN/LEFT/RIGHT)과 칸수(1~3)를 가진다. 중간에 장애물에 막히면 거기서 중단된다.',
  schema: moveSchema,
})

const moveHandler: ToolHandler = async (args, ctx) => {
  const actions = Array.isArray(args?.actions) ? args.actions : [{ direction: 'RIGHT', steps: 1 }]
  const limited = actions.slice(0, 4)
  let lastResult: Record<string, any> = { status: 'ok' }

  for (const action of limited) {
    const direction = String(action?.direction || 'RIGHT') as Direction
    const steps = Math.max(1, Math.min(3, Number(action?.steps) || 1))
    const result = ctx.engine.movePlayer(direction, steps)
    const pos = safePos(result?.pos)
    lastResult = result
    ctx.callbacks.onLog(
      `move ${direction} x${Number(result?.actualSteps ?? 0)}/${steps} -> (${pos.x}, ${pos.y})`,
      result?.blocked ? 'error' : 'tool',
    )
    ctx.callbacks.onPlayerMoved({ ...result, direction })
    if (result?.blocked) break
    await new Promise(r => setTimeout(r, 400))
  }

  return { lastResult }
}

export const updateNotepadTool = tool(async () => 'ok', {
  name: 'update_notepad',
  description: '메모장 전체를 덮어쓴다. 매 턴 시야 분석 후 새 정보가 있으면 반드시 호출하며, 유지할 내용도 포함해서 작성해야 한다. 최대 2000자.',
  schema: updateNotepadSchema,
})

const updateNotepadHandler: ToolHandler = async (args, ctx) => {
  const content = String(args?.content || '')
  const notepad = content.slice(0, 2000)
  ctx.callbacks.onLog(`notepad 갱신 (${content.length} chars)`, 'memory')
  return { notepad, lastResult: { status: 'updated' } }
}

export const declareFoundTool = tool(async () => 'ok', {
  name: 'declare_found',
  description: '특정 타겟을 찾아서 도달했음을 선언한다. 나머지 타겟 탐색을 위해 미션은 계속된다.',
  schema: declareFoundSchema,
})

const declareFoundHandler: ToolHandler = async (args, ctx) => {
  const target = String(args?.target || '').trim()
  const foundTargets = [...ctx.foundTargets]
  if (target && !foundTargets.includes(target)) {
    foundTargets.push(target)
  }
  ctx.callbacks.onLog(`declare_found: ${target} (총 ${foundTargets.length}개)`, 'tool')
  return { foundTargets, lastResult: { status: 'found', target, total: foundTargets.length } }
}

export const declareDoneTool = tool(async () => 'ok', {
  name: 'declare_done',
  description: '전체 미션이 완료되었음을 선언한다. 필요한 타겟을 모두 찾은 후에만 호출한다.',
  schema: declareDoneSchema,
})

const declareDoneHandler: ToolHandler = async (_args, ctx) => {
  ctx.callbacks.onLog('declare_done 호출', 'system')
  return { done: true, stopReason: 'declare_done', lastResult: { status: 'done' }, shouldBreak: true }
}

export const toolHandlers: Record<string, ToolHandler> = {
  move: moveHandler,
  update_notepad: updateNotepadHandler,
  declare_found: declareFoundHandler,
  declare_done: declareDoneHandler,
}

export function getAllTools() {
  return [moveTool, updateNotepadTool, declareFoundTool, declareDoneTool]
}