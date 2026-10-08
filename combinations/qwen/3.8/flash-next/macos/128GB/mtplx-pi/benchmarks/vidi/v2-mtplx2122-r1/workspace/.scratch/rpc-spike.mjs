// Spike: does Durable Object RPC (stub.method()) work in this workerd/miniflare?
import { Miniflare } from 'miniflare'

const script = `
import { DurableObject } from 'cloudflare:workers'

export class Room extends DurableObject {
  async initialize() {
    const existing = await this.ctx.storage.get('created_at')
    if (existing !== undefined) return 'exists'
    await this.ctx.storage.put('created_at', Date.now())
    return 'created'
  }
  async exists() {
    return (await this.ctx.storage.get('created_at')) !== undefined
  }
  fetch() { return new Response('room fetch') }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/rpc') {
      const id = env.ROOM.idFromName('abc')
      const stub = env.ROOM.get(id)
      const first = await stub.initialize()
      const second = await stub.initialize()
      const exists = await stub.exists()
      return new Response(JSON.stringify({ first, second, exists }))
    }
    if (url.pathname === '/ws') {
      const id = env.ROOM.idFromName('abc')
      const stub = env.ROOM.get(id)
      const res = await stub.fetch('http://x/y')
      return new Response(await res.text())
    }
    return new Response('root')
  },
}
`

const mf = new Miniflare({
  host: '127.0.0.1',
  port: 25789,
  modules: true,
  script,
  compatibilityDate: '2025-02-14',
  durableObjects: {
    ROOM: { className: 'Room', useSQLite: true },
  },
})

for (const path of ['/rpc', '/ws', '/rpc']) {
  const res = await mf.dispatchFetch(`http://localhost${path}`)
  console.log(path, res.status, await res.text())
}
await mf.dispose()
