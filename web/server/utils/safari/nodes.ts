import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { Page } from 'playwright'
import type { GameEngine } from './game-engine'
import { SYSTEM_PROMPT, toolHandlers, safePos, type AgentCallbacks } from './tools'

export type ToolCall = { name: string; args: Record<string, any> }
export { type AgentCallbacks } from './tools'

export async function captureScreenshot(page: Page): Promise<string | null> {
  try {
    const canvas = page.locator('canvas')
    const buffer = await canvas.screenshot({ type: 'png' })
    return `data:image/png;base64,${buffer.toString('base64')}`
  } catch (err) {
    console.error('Screenshot failed:', err)
    return null
  }
}

type NodeContext = {
  engine: GameEngine
  callbacks: AgentCallbacks
  model: any
  getPage: () => Page | null
  isStopRequested: () => boolean
}

export function createNodes(ctx: NodeContext) {
  const { engine, callbacks, model, getPage, isStopRequested } = ctx

  const captureNode = async (state: any) => {
    if (isStopRequested()) {
      return { done: true, stopReason: 'stopped by user' }
    }
    // Wait a bit for canvas to update after previous move
    await new Promise(r => setTimeout(r, 500))
    const page = getPage()
    const image = page ? await captureScreenshot(page) : null
    if (!image) {
      return { done: true, stopReason: 'capture failed', imageDataUrl: '' }
    }
    callbacks.onLog(`[턴 ${state.step + 1}] capture 완료`, 'system')
    callbacks.onChat('human', '현재 10x10 시야 이미지', image)
    return { imageDataUrl: image }
  }

  const agentNode = async (state: any) => {
    if (state.done) return {}
    if (isStopRequested()) {
      return { done: true, stopReason: 'stopped by user' }
    }
    if (state.step >= state.maxSteps) {
      return { done: true, stopReason: 'max steps reached' }
    }

    const pos = safePos(engine.getPlayer())
    const contextText = [
      `Mission: ${state.mission}`,
      `Step: ${state.step + 1}/${state.maxSteps}`,
      `Position: (${pos.x}, ${pos.y})`,
      '',
      `Found Targets: ${state.foundTargets.length ? state.foundTargets.join(', ') : '(none)'}`,
      '',
      'Notepad:',
      state.notepad || '(empty)',
    ].join('\n')

    callbacks.onChat('human', contextText)

    const response = await model.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage({
        content: [
          { type: 'text', text: contextText },
          { type: 'image_url', image_url: { url: state.imageDataUrl } },
        ] as any,
      }),
    ])

    const rawCalls = Array.isArray((response as any).tool_calls) ? (response as any).tool_calls : []
    const toolCalls: ToolCall[] = rawCalls.map((c: any) => ({ name: String(c.name), args: c.args || {} }))

    if (toolCalls.length === 0) {
      callbacks.onLog(`[턴 ${state.step + 1}] agent 결정: none`, 'response')
      callbacks.onChat('ai', '(tool call 없음)')
    } else {
      const names = toolCalls.map(c => c.name).join(' + ')
      callbacks.onLog(
        `[턴 ${state.step + 1}] agent 결정: ${names}`,
        'response',
        toolCalls.map(c => `${c.name}(${JSON.stringify(c.args)})`).join('\n'),
      )
      callbacks.onChat('ai', toolCalls.map(c => `🔧 ${c.name}(${JSON.stringify(c.args)})`).join('\n'))
    }
    return { lastToolCalls: toolCalls }
  }

  const actNode = async (state: any) => {
    if (state.done) return {}
    const calls = state.lastToolCalls
    if (!calls || calls.length === 0) {
      return {
        step: state.step + 1,
        lastResult: { status: 'no_tool_call' },
      }
    }

    let notepad = state.notepad
    let foundTargets = [...state.foundTargets]
    let lastResult: Record<string, any> = { status: 'ok' }
    let done = false
    let stopReason = ''

    for (const call of calls) {
      const handler = toolHandlers[call.name]
      if (!handler) {
        lastResult = { status: 'unknown_tool', name: call.name }
        callbacks.onChat('tool', `❌ unknown tool: ${call.name}`)
        continue
      }

      const result = await handler(call.args, { engine, callbacks, notepad, foundTargets })
      callbacks.onChat('tool', `${call.name} → ${JSON.stringify(result.lastResult)}`)
      if (result.notepad !== undefined) notepad = result.notepad
      if (result.foundTargets) foundTargets = result.foundTargets
      lastResult = result.lastResult
      if (result.done) done = true
      if (result.stopReason) stopReason = result.stopReason
      if (result.shouldBreak) break
    }

    return {
      step: state.step + 1,
      notepad,
      foundTargets,
      lastResult,
      done,
      stopReason,
    }
  }

  const routeAfterAct = (state: any) => {
    if (state.done || isStopRequested()) return 'end'
    return 'capture'
  }

  return { captureNode, agentNode, actNode, routeAfterAct }
}
