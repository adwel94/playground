import { createEmojiRecognitionEngine, type EmojiRecognitionEngine, type IdentifiedAnimal } from '../../utils/emoji-recognition/game-engine'
import { EmojiRecognitionCollector } from '../../utils/emoji-recognition/data-collector'
import { EMOJI_REC_COLOR_NAMES_KO } from '../../utils/emoji-recognition/constants'

type Session = {
  id: string
  engine: EmojiRecognitionEngine
  collector: EmojiRecognitionCollector
  peers: Set<any>
  isRunning: boolean
  stopRequested: boolean
  screenshotResolve: ((data: string) => void) | null
}

const sessions = new Map<string, Session>()

function getOrCreateSession(sessionId: string): Session {
  let session = sessions.get(sessionId)
  if (!session) {
    session = {
      id: sessionId,
      engine: createEmojiRecognitionEngine(),
      collector: new EmojiRecognitionCollector(),
      peers: new Set(),
      isRunning: false,
      stopRequested: false,
      screenshotResolve: null,
    }
    sessions.set(sessionId, session)
  }
  return session
}

function broadcast(session: Session, message: any) {
  const data = JSON.stringify(message)
  for (const peer of session.peers) {
    try { peer.send(data) } catch { /* ignore */ }
  }
}

function getSessionId(peer: any): string | null {
  return (peer as any).__emojiRecSessionId ?? null
}

function waitForScreenshot(session: Session, timeoutMs = 10000): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      session.screenshotResolve = null
      resolve(null)
    }, timeoutMs)

    session.screenshotResolve = (data: string) => {
      clearTimeout(timer)
      session.screenshotResolve = null
      resolve(data)
    }
  })
}

function parseNotepadResponse(text: string): IdentifiedAnimal[] {
  const animals: IdentifiedAnimal[] = []
  // 패턴: (x,y) 색상 동물(이모지)
  const regex = /\((\d+)\s*,\s*(\d+)\)\s*(\S+)\s+(\S+)\s*\(([^)]+)\)/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const [, xStr, yStr, colorName, name, emoji] = match
    // 색상 이름 → hex 역매핑
    const bgColor = Object.entries(EMOJI_REC_COLOR_NAMES_KO).find(([, v]) => v === colorName)?.[0] ?? ''
    animals.push({
      emoji: emoji!,
      name: name!,
      bgColor,
      colorName: colorName!,
      viewportX: parseInt(xStr!, 10),
      viewportY: parseInt(yStr!, 10),
    })
  }
  return animals
}

async function runAutoPlay(session: Session, totalRounds: number, modelId?: string) {
  if (session.isRunning) {
    broadcast(session, { type: 'log', msg: '이미 실행 중입니다.', logType: 'error' })
    return
  }

  session.isRunning = true
  session.stopRequested = false

  // lazy import LLM
  let identifyAnimals: typeof import('../../utils/emoji-recognition/llm').identifyAnimals
  try {
    const llmModule = await import('../../utils/emoji-recognition/llm')
    identifyAnimals = llmModule.identifyAnimals
  } catch (err: any) {
    broadcast(session, { type: 'log', msg: `LLM 모듈 로드 실패: ${err?.message}`, logType: 'error' })
    session.isRunning = false
    return
  }

  let correctTotal = 0

  try {
    for (let i = 0; i < totalRounds; i++) {
      if (session.stopRequested) {
        broadcast(session, { type: 'log', msg: '사용자에 의해 중지됨', logType: 'system' })
        break
      }

      // Generate round
      const round = session.engine.generateRound()
      broadcast(session, { type: 'gameState', state: round.gridState })
      broadcast(session, {
        type: 'roundInfo',
        roundNumber: round.roundNumber,
        answer: session.engine.getAnswerText(),
      })

      // Wait a bit for canvas to render, then request screenshot from client
      await new Promise(r => setTimeout(r, 300))
      broadcast(session, { type: 'needScreenshot' })

      // Wait for client to send screenshot
      const screenshot = await waitForScreenshot(session)
      if (!screenshot) {
        broadcast(session, { type: 'log', msg: `라운드 ${round.roundNumber}: 스크린샷 수신 실패 (타임아웃)`, logType: 'error' })
        continue
      }

      // LLM identification
      broadcast(session, { type: 'log', msg: `라운드 ${round.roundNumber}: LLM 분석 중... (${modelId || 'default'})`, logType: 'system' })
      let llmResult
      try {
        llmResult = await identifyAnimals(screenshot, modelId)
      } catch (err: any) {
        broadcast(session, { type: 'log', msg: `LLM 오류: ${err?.message}`, logType: 'error' })
        continue
      }

      // Parse LLM response
      const identified = parseNotepadResponse(llmResult.notepadContent)

      // Validate
      const validation = session.engine.validateAnswer(identified)
      const isCorrect = validation.missed.length === 0 && validation.wrong.length === 0
      if (isCorrect) correctTotal++

      // Broadcast result
      broadcast(session, {
        type: 'roundResult',
        roundNumber: round.roundNumber,
        llmResponse: llmResult.notepadContent,
        thought: llmResult.thought,
        validation,
        answer: session.engine.getAnswerText(),
      })

      broadcast(session, {
        type: 'progress',
        current: i + 1,
        total: totalRounds,
        correct: correctTotal,
      })

      // Collect data
      if (llmResult.collectData) {
        await session.collector.recordRound({
          roundNumber: round.roundNumber,
          screenshot,
          visibleAnimals: round.viewportAnimals,
          llmResponse: llmResult.notepadContent,
          thought: llmResult.thought,
          isCorrect,
        })
      }

      broadcast(session, { type: 'log', msg: `라운드 ${round.roundNumber}: ${isCorrect ? '✓ 정답' : '✗ 오답'} (정답률 ${Math.round(correctTotal / (i + 1) * 100)}%)`, logType: isCorrect ? 'success' : 'warn' })
    }
  } catch (err: any) {
    broadcast(session, { type: 'log', msg: `에러: ${err?.message}`, logType: 'error' })
  } finally {
    session.isRunning = false
    const entryCount = session.collector.getEntryCount()
    broadcast(session, { type: 'log', msg: entryCount > 0 ? `완료! 데이터 ${entryCount}건 저장됨` : '완료!', logType: 'system' })
    broadcast(session, { type: 'autoComplete', total: totalRounds, correct: correctTotal })
  }
}

export default defineWebSocketHandler({
  open(peer) {
    const url = peer.request?.url || ''
    const match = url.match(/[?&]sessionId=([^&]+)/)
    const sessionId = (match && match[1]) || crypto.randomUUID()
    ;(peer as any).__emojiRecSessionId = sessionId

    const session = getOrCreateSession(sessionId)
    session.peers.add(peer)

    // Send initial state (generate first round)
    const round = session.engine.generateRound()
    peer.send(JSON.stringify({ type: 'gameState', state: round.gridState }))
    peer.send(JSON.stringify({
      type: 'roundInfo',
      roundNumber: round.roundNumber,
      answer: session.engine.getAnswerText(),
    }))
  },

  async message(peer, message) {
    const sessionId = getSessionId(peer)
    if (!sessionId) return
    const session = sessions.get(sessionId)
    if (!session) return

    let msg: any
    try { msg = JSON.parse(message.text()) } catch { return }

    switch (msg.type) {
      case 'init': {
        const round = session.engine.generateRound()
        broadcast(session, { type: 'gameState', state: round.gridState })
        broadcast(session, {
          type: 'roundInfo',
          roundNumber: round.roundNumber,
          answer: session.engine.getAnswerText(),
        })
        break
      }

      case 'next-round': {
        const round = session.engine.generateRound()
        broadcast(session, { type: 'gameState', state: round.gridState })
        broadcast(session, {
          type: 'roundInfo',
          roundNumber: round.roundNumber,
          answer: session.engine.getAnswerText(),
        })
        break
      }

      case 'start-auto': {
        const rounds = Math.max(1, Math.min(500, Number(msg.rounds) || 50))
        runAutoPlay(session, rounds, msg.modelId)
        break
      }

      case 'screenshot': {
        if (session.screenshotResolve && msg.data) {
          session.screenshotResolve(msg.data)
        }
        break
      }

      case 'stop': {
        session.stopRequested = true
        break
      }
    }
  },

  close(peer) {
    const sessionId = getSessionId(peer)
    if (!sessionId) return
    const session = sessions.get(sessionId)
    if (!session) return
    session.peers.delete(peer)
    if (session.peers.size === 0 && !session.isRunning) {
      sessions.delete(sessionId)
    }
  },
})
