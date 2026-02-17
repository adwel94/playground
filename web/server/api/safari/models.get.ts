import { getModels } from '../../utils/safari/llm'

export default defineEventHandler(() => {
  return getModels().map(({ id, label }) => ({ id, label }))
})
