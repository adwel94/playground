import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { chromium } from 'playwright'
import type { GameEngine } from './game-engine'
import { getAllTools, SYSTEM_PROMPT } from './tools'
import { createNodes, type ToolCall, type AgentCallbacks } from './nodes'
import type { AgentState } from '../../routes/_ws/safari'

const GraphState = Annotation.Root({
  mission: Annotation<string>,
  step: Annotation<number>,
  maxSteps: Annotation<number>,
  done: Annotation<boolean>,
  stopReason: Annotation<string>,
  imageDataUrl: Annotation<string>,
  notepad: Annotation<string>,
  foundTargets: Annotation<string[]>,
  lastToolCalls: Annotation<ToolCall[]>,
  lastResult: Annotation<Record<string, any>>,
})

export async function startAgent(
  mission: string,
  engine: GameEngine,
  callbacks: AgentCallbacks,
  agentState: AgentState,
  sessionId: string,
) {
  if (agentState.isRunning) {
    callbacks.onLog('에이전트가 이미 실행 중입니다.', 'error')
    return
  }

  agentState.isRunning = true
  agentState.stopRequested = false
  callbacks.onStatus('running')
  callbacks.onChat('human', mission)

  // Get runtime config for API key
  const config = useRuntimeConfig()

  if (!config.googleApiKey) {
    callbacks.onLog('GOOGLE_API_KEY가 설정되지 않았습니다.', 'error')
    callbacks.onStatus('stopped')
    agentState.isRunning = false
    return
  }

  // Launch Playwright browser
  try {
    callbacks.onLog('Playwright 브라우저 시작 중...', 'system')
    agentState.browser = await chromium.launch({ headless: false })
    const context = await agentState.browser.newContext({
      viewport: { width: 480, height: 480 },
    })
    agentState.page = await context.newPage()
    await agentState.page.goto(`http://localhost:3000/safari/agent-view?sessionId=${sessionId}`)
    // Wait for canvas to render
    await agentState.page.waitForSelector('canvas', { timeout: 10000 })
    // Give WebSocket time to connect and render initial state
    await new Promise(r => setTimeout(r, 1500))
    callbacks.onLog('Playwright 브라우저 준비 완료', 'system')
  } catch (err: any) {
    callbacks.onLog(`Playwright 시작 실패: ${err?.message || err}`, 'error')
    callbacks.onStatus('stopped')
    agentState.isRunning = false
    await cleanupBrowser(agentState)
    return
  }

  const model = new ChatGoogleGenerativeAI({
    apiKey: config.googleApiKey,
    model: config.visionSafariModel || 'gemini-2.0-flash',
    temperature: 0,
  }).bindTools(getAllTools())

  callbacks.onLog(`에이전트 Model: ${config.visionSafariModel}`, 'system')
  const { captureNode, agentNode, actNode, routeAfterAct } = createNodes({
    engine,
    callbacks,
    model,
    getPage: () => agentState.page,
    isStopRequested: () => agentState.stopRequested,
  })

  const graph = new StateGraph(GraphState)
    .addNode('capture', captureNode)
    .addNode('agent', agentNode)
    .addNode('act', actNode)
    .addEdge(START, 'capture')
    .addEdge('capture', 'agent')
    .addEdge('agent', 'act')
    .addConditionalEdges('act', routeAfterAct, {
      capture: 'capture',
      end: END,
    })
    .compile()

  // Run the graph
  const maxSteps = 180
  try {
    callbacks.onLog(`에이전트 시작: "${mission}"`, 'system')
    callbacks.onChat('system', SYSTEM_PROMPT)
    const finalState = await graph.invoke(
      {
        mission,
        step: 0,
        maxSteps,
        done: false,
        stopReason: '',
        imageDataUrl: '',
        notepad: '',
        foundTargets: [],
        lastToolCalls: [],
        lastResult: {},
      },
      { recursionLimit: maxSteps * 5 },
    )
    callbacks.onLog(`에이전트 종료: ${finalState.stopReason || 'completed'}`, 'system')
  } catch (err: any) {
    callbacks.onLog(`에이전트 에러: ${err?.message || String(err)}`, 'error')
  } finally {
    agentState.isRunning = false
    callbacks.onStatus('done')
    await cleanupBrowser(agentState)
  }
}

export function stopAgent(agentState: AgentState) {
  agentState.stopRequested = true
}

async function cleanupBrowser(agentState: AgentState) {
  try {
    if (agentState.page) {
      await agentState.page.close().catch(() => {})
      agentState.page = null
    }
    if (agentState.browser) {
      await agentState.browser.close().catch(() => {})
      agentState.browser = null
    }
  } catch {
    // ignore cleanup errors
  }
}
