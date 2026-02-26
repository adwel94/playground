import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { EMOJI_REC_SYSTEM_PROMPT } from './data-collector'

export type LLMResult = {
  notepadContent: string
  thought: string | null
  collectData: boolean
  rawResponse: any
}

type EmojiRecModel = {
  id: string
  label: string
  provider: 'gemini' | 'vllm'
  collectData: boolean
  raw: ChatGoogleGenerativeAI | ChatOpenAI
}

let models: EmojiRecModel[] = []

const tools = [{
  name: 'update_notepad',
  description: '관찰 결과를 메모장에 기록합니다. 발견한 모든 동물의 위치, 색상, 종류를 기록하세요.',
  schema: {
    type: 'object' as const,
    properties: {
      content: { type: 'string', description: '관찰 내용' },
    },
    required: ['content'],
  },
}]

export function getERModels(): EmojiRecModel[] {
  if (models.length === 0) initModels()
  return models
}

function initModels() {
  const config = useRuntimeConfig()
  models = []

  // Gemini
  try {
    if (config.googleApiKey) {
      const modelName = (config.visionSafariModel as string) || 'gemini-3-flash-preview'
      const raw = new ChatGoogleGenerativeAI({
        apiKey: config.googleApiKey as string,
        model: modelName,
        temperature: 0,
        thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 },
      })
      models.push({ id: 'gemini', label: `Gemini (${modelName})`, provider: 'gemini', collectData: true, raw })
    }
  } catch (err) {
    console.error('[EmojiRec LLM] Gemini 초기화 실패:', err)
  }

  // vLLM local
  try {
    if (config.vllmBaseUrl) {
      const raw = new ChatOpenAI({
        configuration: { baseURL: config.vllmBaseUrl as string },
        model: 'Qwen3-VL-2B-Thinking-FP8',
        apiKey: 'EMPTY',
        temperature: 0,
        maxTokens: 4096,
      })
      models.push({ id: 'vllm-Qwen3-VL-2B-Thinking-FP8', label: 'vLLM (Qwen3-VL-2B-Thinking-FP8)', provider: 'vllm', collectData: false, raw })
    }
  } catch (err) {
    console.error('[EmojiRec LLM] vLLM 초기화 실패:', err)
  }

  // vLLM RunPod
  try {
    if (config.runpodApiUrl && config.runpodApiKey) {
      const raw = new ChatOpenAI({
        configuration: { baseURL: config.runpodApiUrl as string },
        model: 'qwen/qwen3-vl-4b-thinking-fp8',
        apiKey: config.runpodApiKey as string,
        temperature: 0,
        maxTokens: 4096,
      })
      models.push({ id: 'vllm-Qwen3-VL-4B-FP8', label: 'vLLM (Qwen3-VL-4B-Thinking-FP8)', provider: 'vllm', collectData: false, raw })
    }
  } catch (err) {
    console.error('[EmojiRec LLM] vLLM RunPod 초기화 실패:', err)
  }

  console.log('[EmojiRec LLM] 등록된 모델:', models.map(m => m.id))
}

function extractThought(response: any): string | null {
  // LangChain format
  const content = response?.content
  if (Array.isArray(content)) {
    const thoughts = content
      .filter((p: any) => p.type === 'thinking')
      .map((p: any) => p.thinking)
    if (thoughts.length > 0) return thoughts.join('\n')
  }
  // Raw Gemini format (lc_kwargs)
  const lc = response?.lc_kwargs
  if (lc?.additional_kwargs?.raw) {
    const parts = lc.additional_kwargs.raw.candidates?.[0]?.content?.parts
    if (Array.isArray(parts)) {
      const thoughts = parts.filter((p: any) => p.thought === true).map((p: any) => p.text)
      if (thoughts.length > 0) return thoughts.join('\n')
    }
  }
  // additional_kwargs.raw (MALFORMED_FUNCTION_CALL 등)
  const rawCandidates = response?.additional_kwargs?.raw?.candidates
  if (Array.isArray(rawCandidates)) {
    const parts = rawCandidates[0]?.content?.parts
    if (Array.isArray(parts)) {
      const thoughts = parts.filter((p: any) => p.thought === true).map((p: any) => p.text)
      if (thoughts.length > 0) return thoughts.join('\n')
    }
  }
  return null
}

function extractNotepadContent(response: any): string {
  // 1) tool_calls에서 update_notepad의 content 추출
  const toolCalls = response?.tool_calls
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      if (tc.name === 'update_notepad' && tc.args?.content) {
        return tc.args.content
      }
    }
  }

  // 2) MALFORMED_FUNCTION_CALL fallback — finishMessage에서 내용 추출
  const kwargs = response?.additional_kwargs
  if (kwargs?.finishReason === 'MALFORMED_FUNCTION_CALL' && kwargs.finishMessage) {
    const fm = kwargs.finishMessage as string
    let extracted: string | null = null
    // @" ... " 형태 (Gemini가 자주 생성하는 패턴)
    const atQuoteMatch = fm.match(/@"([\s\S]+)"(?:\s*\}|$)/)
    if (atQuoteMatch) extracted = atQuoteMatch[1]!
    // 일반 큰따옴표 형태
    if (!extracted) {
      const quoteMatch = fm.match(/(?:content|notes)\s*[:=]\s*"([\s\S]+)"(?:\s*\}|$)/)
      if (quoteMatch) extracted = quoteMatch[1]!
    }
    // 관찰 패턴이 직접 포함된 경우
    if (!extracted) {
      const obsMatch = fm.match(/(\[관찰\][\s\S]+)/)
      if (obsMatch) extracted = obsMatch[1]!.replace(/"\s*\}\s*$/, '')
    }
    if (extracted) {
      // finishMessage 내 리터럴 \n을 실제 개행으로 변환
      return extracted.replace(/\\n/g, '\n')
    }
  }

  // 3) fallback: 텍스트 응답에서 추출
  const text = typeof response?.content === 'string' ? response.content : ''
  return text || '(no response)'
}

export async function identifyAnimals(screenshotDataUrl: string, modelId?: string): Promise<LLMResult> {
  const allModels = getERModels()
  if (allModels.length === 0) throw new Error('사용 가능한 모델이 없습니다')

  const entry = (modelId ? allModels.find(m => m.id === modelId) : null) ?? allModels[0]!
  const llm = entry.raw

  const boundModel = llm.bindTools(tools)

  const contextText = `이 이미지에서 보이는 동물을 모두 식별해주세요.
각 동물의 위치(x,y), 배경색, 동물 종류를 정확히 기록해주세요.
update_notepad 도구를 사용하여 결과를 기록하세요.`

  const response = await boundModel.invoke([
    new SystemMessage(EMOJI_REC_SYSTEM_PROMPT),
    new HumanMessage({
      content: [
        { type: 'image_url', image_url: { url: screenshotDataUrl } },
        { type: 'text', text: contextText },
      ],
    }),
  ])

  const notepadContent = extractNotepadContent(response)
  const thought = extractThought(response)

  const finishReason = response?.additional_kwargs?.finishReason
  if (finishReason && finishReason !== 'STOP') {
    console.log(`[EmojiRec LLM] finishReason: ${finishReason}, extracted: ${notepadContent.slice(0, 100)}...`)
  }

  return {
    notepadContent,
    thought,
    collectData: entry.collectData,
    rawResponse: response,
  }
}
