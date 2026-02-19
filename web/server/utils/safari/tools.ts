import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { GameEngine, Direction, CatchResult } from './game-engine'

export type AgentCallbacks = {
  onLog: (msg: string, logType: string, detail?: string) => void
  onChat: (role: string, content: string, image?: string) => void
  onStatus: (status: string) => void
  onPlayerMoved: (result: any) => void
  onAnimalCaught: (result: CatchResult, gameState: any) => void
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
- 색깔 배경 위의 동물 이모지 = 타겟 (장애물, 통과 불가)

매 턴마다 현재 10x10 시야가 이미지로 자동 제공돼.

게임 루프 - 관찰 → 접근 → 포획:
1. 시야 이미지를 관찰해서 타겟 동물을 찾는다.
2. Move로 타겟 동물의 인접 타일까지 접근한다. (동물은 장애물이므로 위로 이동 불가)
3. 동물 바로 옆에 도달하면 Catch(direction)를 호출해서 포획한다.

필수 규칙:
- 한 턴에 여러 도구를 동시에 호출할 수 있다. 예: Move + UpdateNotepad를 함께 호출.
- 제공된 시야 이미지를 분석한 후 다음 행동을 결정해.
- 동물과 나무 모두 이동을 막는다. 동물 위로 걸어갈 수 없다.
- 동물의 인접 타일(상하좌우)에 도달하면 Catch(direction)를 호출해서 포획해.
- Catch 성공 후 타겟과 일치하면 DeclareFound를 호출해.
- 모든 타겟을 찾은 후 DeclareDone을 호출해.
- 이동이 막혔으면(actual_steps < 요청한 수) 다른 방향을 시도해.

멀티 미션 워크플로우:
- 여러 타겟을 찾아야 할 수 있어 (예: "빨간 호랑이와 분홍 기린을 찾아").
- 타겟을 찾을 때마다: DeclareFound를 호출해 (예: "빨간배경 호랑이").
- 모든 타겟을 찾은 후: DeclareDone을 호출해서 미션을 종료해.
- 메모리 컨텍스트의 "찾은 타겟" 항목을 확인해서 이미 찾은 타겟을 파악해.

메모장 프로토콜:
- 덮어쓰기 방식. 유지할 내용도 반드시 포함해서 작성해. 빠뜨리면 사라져!
- 메모장은 미션 간에도 보존돼. 이전 미션의 맵 정보를 활용할 수 있어.
- 매 턴 반드시 update_notepad를 호출해.
- 아래 형식을 따라:

[맵] 5x5 격자 (각 칸=10x10 구역, V=탐색완료, .=미탐색)
.....
.....
..V..
.....
.....
[목격] 동물@(x,y), 타겟이면 !표시. 예: 🐯@(35,28)!
[계획] 다음 이동 목표와 이유

- 현재 위치의 구역 = (x÷10, y÷10). 예: (25,25) → 3행3열.
- 구역을 관찰했으면 V로 표시하고 미탐색(.) 구역으로 이동해.

탐색 전략:
1. 시야에 타겟 보이면 → 접근해서 Catch.
2. [목격]에 타겟(!) 있으면 → 해당 좌표로 이동.
3. 둘 다 없으면 → [맵]에서 가장 가까운 미탐색(.) 구역 중심으로 이동.
- V 구역은 재방문하지 마.
- 막히면 우회해서 같은 목표로 계속 이동해.
- Move 한 번에 최대 4방향, 각 최대 3칸.`

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
  description: '플레이어를 이동시킨다. 최대 4개 행동을 순서대로 실행하며, 각 행동은 방향(UP/DOWN/LEFT/RIGHT)과 칸수(1~3)를 가진다. 나무와 동물 모두 이동을 막으며, 중간에 막히면 거기서 중단된다.',
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

const catchSchema = z.object({
  direction: z.enum(['UP', 'DOWN', 'LEFT', 'RIGHT']),
})

export const catchTool = tool(async () => 'ok', {
  name: 'catch',
  description: '인접 타일(상하좌우)의 동물을 포획한다. 동물이 있는 방향을 지정하면 해당 동물을 잡아서 맵에서 제거한다.',
  schema: catchSchema,
})

const catchHandler: ToolHandler = async (args, ctx) => {
  const direction = String(args?.direction || 'RIGHT') as Direction
  const result = ctx.engine.catchAnimal(direction)

  if (result.success) {
    ctx.callbacks.onLog(
      `catch ${direction} -> ${result.animal!.emoji} 포획! (${result.position!.x}, ${result.position!.y})`,
      'tool',
    )
    ctx.callbacks.onAnimalCaught(result, ctx.engine.getState())
  } else {
    ctx.callbacks.onLog(
      `catch ${direction} -> 실패 (${result.reason})`,
      'error',
    )
  }

  return { lastResult: result }
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
  catch: catchHandler,
  update_notepad: updateNotepadHandler,
  declare_found: declareFoundHandler,
  declare_done: declareDoneHandler,
}

export function getAllTools() {
  return [moveTool, catchTool, updateNotepadTool, declareFoundTool, declareDoneTool]
}