import { getERModels } from '../../utils/emoji-recognition/llm'

export default defineEventHandler(() => {
  return getERModels().map(({ id, label }) => ({ id, label }))
})
