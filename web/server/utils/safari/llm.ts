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

const config = useRuntimeConfig()
const tools = getAllTools()

export const models: LLMEntry[] = []

// Gemini
try {
  if (config.googleApiKey) {
    const modelName = config.visionSafariModel || 'gemini-3-flash-preview'
    const raw = new ChatGoogleGenerativeAI({
      apiKey: config.googleApiKey,
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
} catch { /* skip */ }

// vLLM
try {
  if (config.vllmBaseUrl) {
    const raw = new ChatOpenAI({
      configuration: { baseURL: config.vllmBaseUrl as string },
      model: 'Qwen/Qwen3-VL-4B-Instruct',
      apiKey: 'EMPTY',
      temperature: 0,
    })
    models.push({
      id: 'vllm',
      label: 'vLLM (Qwen/Qwen3-VL-4B-Instruct)',
      provider: 'vllm',
      model: raw.bindTools(tools),
      raw,
    })
  }
} catch { /* skip */ }
