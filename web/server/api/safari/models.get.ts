import { models } from '../../utils/safari/llm'

export default defineEventHandler(() => {
  return models.map(({ id, label }) => ({ id, label }))
})
