import { createApiServer } from './server.ts'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 8787)

createApiServer().listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`)
})
