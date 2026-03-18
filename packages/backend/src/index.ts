import Fastify from 'fastify'

const DEFAULT_PORT = 3721

export async function startBackend(port = DEFAULT_PORT): Promise<void> {
  const app = Fastify({ logger: false })

  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  await app.listen({ port, host: '127.0.0.1' })
  console.log(`[backend] Fastify listening on http://127.0.0.1:${port}`)
}
