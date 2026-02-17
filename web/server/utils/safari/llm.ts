import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatOpenAI } from '@langchain/openai'
import { getAllTools } from './tools'

export type LLMEntry = {
  id: string
  label: string
  provider: 'gemini' | 'vllm'
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
      })
      models.push({
        id: 'gemini',
        label: `Gemini (${modelName})`,
        provider: 'gemini',
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
        model: 'Qwen/Qwen3-VL-2B-Instruct',
        apiKey: 'EMPTY',
        temperature: 0,
      })
      models.push({
        id: 'vllm',
        label: 'vLLM (Qwen/Qwen3-VL-2B-Instruct)',
        provider: 'vllm',
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
        model: 'qwen/qwen3-vl-4b-thinking',
        apiKey: config.runpodApiKey as string,
        temperature: 0,
      })
      models.push({
        id: 'vllm-Qwen3-VL-4B',
        label: 'vLLM (Qwen/Qwen3-VL-4B-Thinking)',
        provider: 'vllm',
        model: raw.bindTools(tools),
        raw,
      })
    }
  } catch (err) {
    console.error('[Safari LLM] vLLM RunPod 초기화 실패:', err)
  }

  console.log('[Safari LLM] 등록된 모델:', models.map(m => m.id))
}
