import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatOpenAI } from '@langchain/openai'
import { getAllTools } from './tools'

export type LLMEntry = {
  id: string
  label: string
  provider: 'gemini' | 'vllm'
  collectData: boolean
  model: ReturnType<ChatGoogleGenerativeAI['bindTools']>
  raw: ChatGoogleGenerativeAI | ChatOpenAI
}

let models: LLMEntry[] = []

export function getModels(): LLMEntry[] {
  return models
}

export function initModels() {
  const config = useRuntimeConfig()
  const tools = getAllTools()
  models = []

  // Gemini
  try {
    if (config.googleApiKey) {
      const modelName = (config.visionSafariModel as string) || 'gemini-3-flash-preview'
      const raw = new ChatGoogleGenerativeAI({
        apiKey: config.googleApiKey as string,
        model: modelName,
        temperature: 0,
        thinkingConfig: { includeThoughts: true },
      })
      models.push({
        id: 'gemini',
        label: `Gemini (${modelName})`,
        provider: 'gemini',
        collectData: true,
        model: raw.bindTools(tools),
        raw,
      })
    }
  } catch (err) {
    console.error('[Safari LLM] Gemini 초기화 실패:', err)
  }

  // vLLM
  try {
    if (config.vllmBaseUrl) {
      const raw = new ChatOpenAI({
        configuration: { baseURL: config.vllmBaseUrl as string },
        model: 'Qwen3-VL-2B-Thinking-FP8',
        apiKey: 'EMPTY',
        temperature: 0,
        maxTokens: 4096,
      })
      models.push({
        id: 'vllm-Qwen3-VL-2B-Thinking-FP8',
        label: 'vLLM (Qwen/Qwen3-VL-2B-Thinking-FP8)',
        provider: 'vllm',
        collectData: false,
        model: raw.bindTools(tools),
        raw,
      })
    }
  } catch (err) {
    console.error('[Safari LLM] vLLM 초기화 실패:', err)
  }

  // vLLM runpod
  try {
    if (config.runpodApiUrl && config.runpodApiKey) {
      const raw = new ChatOpenAI({
        configuration: { baseURL: config.runpodApiUrl as string },
        model: 'qwen/qwen3-vl-4b-thinking-fp8',
        apiKey: config.runpodApiKey as string,
        temperature: 0,
        maxTokens: 4096,
      })
      models.push({
        id: 'vllm-Qwen3-VL-4B-FP8',
        label: 'vLLM (Qwen/Qwen3-VL-4B-Thinking-FP8)',
        provider: 'vllm',
        collectData: false,
        model: raw.bindTools(tools),
        raw,
      })
    }
  } catch (err) {
    console.error('[Safari LLM] vLLM RunPod 초기화 실패:', err)
  }

  console.log('[Safari LLM] 등록된 모델:', models.map(m => m.id))
}
