import type { FastifyInstance } from 'fastify'
import { memoryService } from '../memory/memory-service'

/** 日期格式校验：YYYY-MM-DD */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function setupCalendarRoutes(app: FastifyInstance): Promise<void> {
  // GET /calendar/dates — 返回有记录的日期列表
  app.get('/calendar/dates', async () => {
    return { dates: memoryService.getAvailableDates() }
  })

  // GET /calendar/:date — 返回指定日期的摘要
  app.get<{ Params: { date: string } }>('/calendar/:date', async (request, reply) => {
    const { date } = request.params
    if (!DATE_RE.test(date)) {
      return reply.status(400).send({ error: 'Invalid date format, expected YYYY-MM-DD' })
    }
    const summary = memoryService.getDaySummary(date)
    if (!summary) {
      return reply.status(404).send({ error: `No archive found for ${date}` })
    }
    return { date, ...summary }
  })

  // GET /calendar/:date/messages — 返回指定日期的完整消息
  app.get<{ Params: { date: string } }>('/calendar/:date/messages', async (request, reply) => {
    const { date } = request.params
    if (!DATE_RE.test(date)) {
      return reply.status(400).send({ error: 'Invalid date format, expected YYYY-MM-DD' })
    }
    const messages = memoryService.getDayMessages(date)
    if (!messages) {
      return reply.status(404).send({ error: `No archive found for ${date}` })
    }
    return { date, messages }
  })
}
