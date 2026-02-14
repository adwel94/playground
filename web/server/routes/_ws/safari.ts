import { createGameEngine, type GameEngine, type Direction } from '../../utils/safari/game-engine'
import type { Browser, Page } from 'playwright'

export type AgentState = {
  browser: Browser | null
  page: Page | null
  stopRequested: boolean
  isRunning: boolean
}

type Session = {
  id: string
  engine: GameEngine
  peers: Set<any>
  agentState: AgentState
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
          onAnimal: result.onAnimal,
          direction,
        })
        break
      }

      case 'mission': {
        const mission = String(msg.mission || '').trim()
        if (!mission) break

        // Lazy-load agent runner to avoid circular deps
        if (!agentRunnerModule) {
          agentRunnerModule = await import('../../utils/safari/graph')
        }
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
              onAnimal: result.onAnimal,
              direction: result.direction,
            })
          },
          onDebug(phase: string, data: any) {
            broadcastToSession(sessionId, { type: 'agentDebug', phase, data })
          },
        }, session.agentState, sessionId)
        break
      }

      case 'stop': {
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
