import { createServer } from 'node:http'

export function createApiServer() {
  return createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')

    if (request.url?.split('?', 1)[0] !== '/api/health.json') {
      response.writeHead(404).end(JSON.stringify({ error: 'not_found' }))
      return
    }

    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET')
      response.writeHead(405).end(JSON.stringify({ error: 'method_not_allowed' }))
      return
    }

    response.end(JSON.stringify({ status: 'ok', source: 'api' }))
  })
}
