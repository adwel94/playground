import { createGameEngine, type GameEngine, type Direction } from '../../utils/safari/game-engine'
import type { Browser, Page } from 'playwright'

export type AgentState = {
  browser: Browser | null
  page: Page | null
  stopRequested: boolean
  isRunning: boolean
}

type AutoPlayState = {
  isRunning: boolean
  stopRequested: boolean
  current: number
  total: number
}

type Session = {
  id: string
  engine: GameEngine
  peers: Set<any>
  agentState: AgentState
  autoPlayState: AutoPlayState
}

const sessions = new Map<string, Session>()

// Agent runner module (lazy-loaded)
let agentRunnerModule: typeof import('../../utils/safari/graph') | null = null

function getOrCreateSession(sessionId: string): Session {
  let session = sessions.get(sessionId)
  if (!session) {
    session = {
      id: sessionId,
      engine: createGameEngine(),
      peers: new Set(),
      agentState: {
        browser: null,
        page: null,
        stopRequested: false,
        isRunning: false,
      },
      autoPlayState: {
        isRunning: false,
        stopRequested: false,
        current: 0,
        total: 0,
      },
    }
    sessions.set(sessionId, session)
  }
  return session
}

function broadcastToSession(sessionId: string, message: any) {
  const session = sessions.get(sessionId)
  if (!session) return
  const data = JSON.stringify(message)
  for (const peer of session.peers) {
    try {
      peer.send(data)
    } catch (_) {
      // ignore send errors
    }
  }
}

function getSessionIdFromPeer(peer: any): string | null {
  return (peer as any).__safariSessionId ?? null
}

async function runAutoPlay(session: Session, sessionId: string, totalRounds: number, modelId: string) {
  if (session.autoPlayState.isRunning) {
    broadcastToSession(sessionId, { type: 'agentLog', msg: '이미 자동 플레이 실행 중입니다.', logType: 'error' })
    return
  }

  // Lazy-load agent runner
  if (!agentRunnerModule) {
    agentRunnerModule = await import('../../utils/safari/graph')
  }

  session.autoPlayState = { isRunning: true, stopRequested: false, current: 0, total: totalRounds }
  broadcastToSession(sessionId, { type: 'autoProgress', current: 0, total: totalRounds, mission: '' })

  try {
    for (let i = 0; i < totalRounds; i++) {
      if (session.autoPlayState.stopRequested) {
        broadcastToSession(sessionId, { type: 'agentLog', msg: '자동 플레이가 사용자에 의해 중지됨', logType: 'system' })
        break
      }

      // 1. 맵 리셋
      session.engine.initGame()
      broadcastToSession(sessionId, { type: 'gameState', state: session.engine.getState() })

      // 2. 미션 자동 생성
      const mission = session.engine.generateRandomMission()
      broadcastToSession(sessionId, { type: 'autoProgress', current: i + 1, total: totalRounds, mission })
      broadcastToSession(sessionId, { type: 'agentLog', msg: `[AutoPlay ${i + 1}/${totalRounds}] 미션: ${mission}`, logType: 'system' })

      // 3. 에이전트 실행 (기존 startAgent 재사용)
      const callbacks = {
        onLog(logMsg: string, logType: string, detail?: string) {
          broadcastToSession(sessionId, { type: 'agentLog', msg: logMsg, logType, detail })
        },
        onChat(role: string, content: string, image?: string) {
          broadcastToSession(sessionId, { type: 'agentChat', role, content, image })
        },
        onStatus(status: string) {
          broadcastToSession(sessionId, { type: 'agentStatus', status })
        },
        onPlayerMoved(result: any) {
          broadcastToSession(sessionId, {
            type: 'playerMoved',
            pos: result.pos,
            moved: result.moved,
            blocked: result.blocked,
            actualSteps: result.actualSteps,
            direction: result.direction,
          })
        },
        onAnimalCaught(result: any, gameState: any) {
          broadcastToSession(sessionId, {
            type: 'animalCaught',
            success: result.success,
            animal: result.animal,
            position: result.position,
          })
          broadcastToSession(sessionId, {
            type: 'gameState',
            state: gameState,
          })
        },
        onDebug(phase: string, data: any) {
          broadcastToSession(sessionId, { type: 'agentDebug', phase, data })
        },
      }

      await agentRunnerModule.startAgent(mission, session.engine, callbacks, session.agentState, sessionId, modelId)
      session.autoPlayState.current = i + 1
    }
  } catch (err: any) {
    broadcastToSession(sessionId, { type: 'agentLog', msg: `AutoPlay 에러: ${err?.message}`, logType: 'error' })
  } finally {
    session.autoPlayState.isRunning = false
    broadcastToSession(sessionId, { type: 'autoComplete', total: totalRounds, completed: session.autoPlayState.current })
  }
}

function cleanupSession(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) return
  if (session.peers.size === 0 && !session.agentState.isRunning) {
    sessions.delete(sessionId)
  }
}

export default defineWebSocketHandler({
  open(peer) {
    // Extract sessionId from URL query
    const url = peer.request?.url || ''
    const match = url.match(/[?&]sessionId=([^&]+)/)
    const sessionId = (match && match[1]) || crypto.randomUUID()

    ;(peer as any).__safariSessionId = sessionId

    const session = getOrCreateSession(sessionId)
    session.peers.add(peer)

    // Send current game state on connect
    peer.send(JSON.stringify({
      type: 'gameState',
      state: session.engine.getState(),
    }))
  },

  async message(peer, message) {
    const sessionId = getSessionIdFromPeer(peer)
    if (!sessionId) return

    const session = sessions.get(sessionId)
    if (!session) return

    const engine = session.engine

    let msg: any
    try {
      msg = JSON.parse(message.text())
    } catch {
      return
    }

    switch (msg.type) {
      case 'init': {
        engine.initGame()
        broadcastToSession(sessionId, {
          type: 'gameState',
          state: engine.getState(),
        })
        break
      }

      case 'move': {
        const direction = msg.direction as Direction
        const steps = Math.max(1, Math.min(3, Number(msg.steps) || 1))
        const result = engine.movePlayer(direction, steps)
        broadcastToSession(sessionId, {
          type: 'playerMoved',
          pos: result.pos,
          moved: result.moved,
          blocked: result.blocked,
          actualSteps: result.actualSteps,
          direction,
        })
        break
      }

      case 'catch': {
        const directions: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT']
        for (const dir of directions) {
          const result = engine.catchAnimal(dir)
          if (result.success) {
            broadcastToSession(sessionId, {
              type: 'animalCaught',
              success: true,
              animal: result.animal,
              position: result.position,
            })
            broadcastToSession(sessionId, {
              type: 'gameState',
              state: engine.getState(),
            })
            break
          }
        }
        break
      }

      case 'mission': {
        const mission = String(msg.mission || '').trim()
        if (!mission) break

        // Lazy-load agent runner to avoid circular deps
        if (!agentRunnerModule) {
          agentRunnerModule = await import('../../utils/safari/graph')
        }
        const modelId = String(msg.modelId || 'gemini')
        agentRunnerModule.startAgent(mission, engine, {
          onLog(logMsg: string, logType: string, detail?: string) {
            broadcastToSession(sessionId, { type: 'agentLog', msg: logMsg, logType, detail })
          },
          onChat(role: string, content: string, image?: string) {
            broadcastToSession(sessionId, { type: 'agentChat', role, content, image })
          },
          onStatus(status: string) {
            broadcastToSession(sessionId, { type: 'agentStatus', status })
          },
          onPlayerMoved(result: any) {
            broadcastToSession(sessionId, {
              type: 'playerMoved',
              pos: result.pos,
              moved: result.moved,
              blocked: result.blocked,
              actualSteps: result.actualSteps,
              direction: result.direction,
            })
          },
          onAnimalCaught(result: any, gameState: any) {
            broadcastToSession(sessionId, {
              type: 'animalCaught',
              success: result.success,
              animal: result.animal,
              position: result.position,
            })
            broadcastToSession(sessionId, {
              type: 'gameState',
              state: gameState,
            })
          },
          onDebug(phase: string, data: any) {
            broadcastToSession(sessionId, { type: 'agentDebug', phase, data })
          },
        }, session.agentState, sessionId, modelId)
        break
      }

      case 'stop': {
        if (agentRunnerModule) {
          agentRunnerModule.stopAgent(session.agentState)
        }
        break
      }

      case 'start-auto': {
        const rounds = Math.max(1, Math.min(100, Number(msg.rounds) || 10))
        const modelId = String(msg.modelId || 'gemini')
        runAutoPlay(session, sessionId, rounds, modelId)
        break
      }

      case 'stop-auto': {
        session.autoPlayState.stopRequested = true
        // 현재 실행 중인 에이전트도 중지
        if (agentRunnerModule) {
          agentRunnerModule.stopAgent(session.agentState)
        }
        break
      }
    }
  },

  close(peer) {
    const sessionId = getSessionIdFromPeer(peer)
    if (!sessionId) return

    const session = sessions.get(sessionId)
    if (!session) return

    session.peers.delete(peer)
    cleanupSession(sessionId)
  },
})
