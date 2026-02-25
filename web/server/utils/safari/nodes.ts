import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { ChatOpenAI } from '@langchain/openai'
import type { Page } from 'playwright'
import type { GameEngine } from './game-engine'
import { SYSTEM_PROMPT, toolHandlers, safePos, getAllTools, type AgentCallbacks } from './tools'
import { convertToOpenAITool } from '@langchain/core/utils/function_calling'
import type { DataCollector } from './data-collector'

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
  raw?: ChatOpenAI
  getPage: () => Page | null
  isStopRequested: () => boolean
  dataCollector?: DataCollector
}

/**
 * 모델이 tool_calls args를 list로 반환하여 zod 검증 실패 시,
 * raw OpenAI client로 재호출하여 args를 dict로 자동 래핑한다.
 * 예: [{"direction":"RIGHT","steps":2}] → {"actions":[{"direction":"RIGHT","steps":2}]}
 */
async function invokeWithToolFallback(
  model: any,
  raw: ChatOpenAI | undefined,
  messages: any[],
  callbacks: AgentCallbacks,
  step: number,
): Promise<any> {
  try {
    return await model.invoke(messages)
  } catch (err: any) {
    const errMsg = err?.message || String(err)
    // args가 list로 반환된 zod 검증 에러인지 확인
    const isArgsListError = errMsg.includes('Expected object') || errMsg.includes('expected_type')
    if (!isArgsListError || !raw) throw err

    callbacks.onLog(`[턴 ${step}] args list→dict 보정 fallback 적용`, 'system')

    // raw OpenAI client로 tool 스키마 포함 재호출
    const openaiTools = getAllTools().map(t => convertToOpenAITool(t))
    const openaiMessages = messages.map((m: any) => {
      const type = m._getType?.()
      if (type === 'system') return { role: 'system' as const, content: m.content }
      if (type === 'human') return { role: 'user' as const, content: m.content }
      return { role: 'assistant' as const, content: m.content || '' }
    })

    const rawClient = (raw as any).client
    if (!rawClient?.chat?.completions) throw err

    const rawResp = await rawClient.chat.completions.create({
      model: (raw as any).model || (raw as any).modelName,
      messages: openaiMessages,
      tools: openaiTools,
      temperature: 0,
      max_tokens: (raw as any).maxTokens || 4096,
    })

    const choice = rawResp.choices?.[0]
    if (!choice) throw err

    // tool_calls 파싱 + args list→dict 보정
    const fixedToolCalls = (choice.message?.tool_calls || []).map((tc: any) => {
      let args = typeof tc.function.arguments === 'string'
        ? JSON.parse(tc.function.arguments)
        : tc.function.arguments
      if (Array.isArray(args)) {
        args = { actions: args }
        callbacks.onLog(`  [보정] ${tc.function.name}: args list → {"actions": [...]} 래핑`, 'system')
      }
      return { name: tc.function.name, args, id: tc.id }
    })

    // langchain AIMessage 호환 형태로 반환
    return {
      content: choice.message?.content || '',
      tool_calls: fixedToolCalls,
      additional_kwargs: { tool_calls: choice.message?.tool_calls || [] },
      response_metadata: {
        token_usage: {
          prompt_tokens: rawResp.usage?.prompt_tokens || 0,
          completion_tokens: rawResp.usage?.completion_tokens || 0,
          total_tokens: rawResp.usage?.total_tokens || 0,
        },
      },
      usage_metadata: rawResp.usage,
    }
  }
}

export function createNodes(ctx: NodeContext) {
  const { engine, callbacks, model, raw, getPage, isStopRequested, dataCollector } = ctx

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
    callbacks.onDebug('request', { step: state.step + 1 })

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage({
        content: [
          { type: 'text', text: contextText },
          { type: 'image_url', image_url: { url: state.imageDataUrl } },
        ] as any,
      }),
    ]

    const reqPayload = {
      messages: messages.map(m => ({ type: m._getType(), content: typeof m.content === 'string' ? m.content : '[multimodal]' })),
    }
    callbacks.onDebug('request-payload', reqPayload)
    dataCollector?.recordRawPayload('request', reqPayload)

    callbacks.onLog(`[턴 ${state.step + 1}] 모델 응답 대기 중...`, 'system')
    const t0 = Date.now()
    let response
    try {
      response = await invokeWithToolFallback(model, raw, messages, callbacks, state.step + 1)
    } catch (err: any) {
      const durationMs = Date.now() - t0
      callbacks.onLog(`[턴 ${state.step + 1}] 모델 호출 실패 (${(durationMs / 1000).toFixed(1)}s): ${err?.message || err}`, 'error')
      return { done: true, stopReason: 'model error' }
    }
    const durationMs = Date.now() - t0

    const resPayload = {
      content: response.content,
      toolCalls: (response as any).tool_calls,
      additional_kwargs: (response as any).additional_kwargs,
      response_metadata: (response as any).response_metadata,
      usage_metadata: (response as any).usage_metadata,
      durationMs,
    }
    callbacks.onDebug('response-payload', resPayload)
    dataCollector?.recordRawPayload('response', resPayload)
    callbacks.onLog(`[턴 ${state.step + 1}] 모델 응답 수신 (${(durationMs / 1000).toFixed(1)}s)`, 'system')

    const rawCalls = Array.isArray((response as any).tool_calls) ? (response as any).tool_calls : []
    const toolCalls: ToolCall[] = rawCalls.map((c: any) => ({ name: String(c.name), args: c.args || {} }))

    if (toolCalls.length === 0) {
      const text = typeof response.content === 'string'
        ? response.content
        : Array.isArray(response.content)
          ? response.content.map((b: any) => b.text || b.thinking || '').filter(Boolean).join('\n')
          : ''
      callbacks.onLog(`[턴 ${state.step + 1}] agent 결정: none`, 'response', text || undefined)
      callbacks.onChat('ai', text || '(tool call 없음)')
    } else {
      const names = toolCalls.map(c => c.name).join(' + ')
      callbacks.onLog(
        `[턴 ${state.step + 1}] agent 결정: ${names}`,
        'response',
        toolCalls.map(c => `${c.name}(${JSON.stringify(c.args)})`).join('\n'),
      )
      callbacks.onChat('ai', toolCalls.map(c => `🔧 ${c.name}(${JSON.stringify(c.args)})`).join('\n'))
    }

    // Record turn data for dataset
    dataCollector?.recordAgentTurn(state.step, contextText, state.imageDataUrl, toolCalls)

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
    const toolResults: { name: string; result: Record<string, any> }[] = []

    for (const call of calls) {
      const handler = toolHandlers[call.name]
      if (!handler) {
        lastResult = { status: 'unknown_tool', name: call.name }
        toolResults.push({ name: call.name, result: lastResult })
        callbacks.onChat('tool', `❌ unknown tool: ${call.name}`)
        continue
      }

      const result = await handler(call.args, { engine, callbacks, notepad, foundTargets })
      callbacks.onChat('tool', `${call.name} → ${JSON.stringify(result.lastResult)}`)
      toolResults.push({ name: call.name, result: result.lastResult })
      if (result.notepad !== undefined) notepad = result.notepad
      if (result.foundTargets) foundTargets = result.foundTargets
      lastResult = result.lastResult
      if (result.done) done = true
      if (result.stopReason) stopReason = result.stopReason
      if (result.shouldBreak) break
    }

    // Send tool results to debug tab
    callbacks.onDebug('tool-results', { results: toolResults })

    // Save turn data immediately
    try {
      await dataCollector?.saveTurn(toolResults)
    } catch (err: any) {
      callbacks.onLog(`[Dataset] 턴 저장 실패: ${err?.message || err}`, 'error')
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
