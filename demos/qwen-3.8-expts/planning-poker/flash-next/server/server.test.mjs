import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocket } from 'ws'
import { createApp } from './server.js'

function connect(url) {
  const ws = new WebSocket(url)
  const client = { ws, latest: null, waiters: [] }
  const fire = () => {
    if (!client.latest) return
    client.waiters = client.waiters.filter((w) => {
      if (w.pred(client.latest)) {
        clearTimeout(w.timer)
        w.resolve(client.latest)
        return false
      }
      return true
    })
  }
  return new Promise((resolve, reject) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'state') client.latest = msg.state
      else if (msg.type === 'error') client.latest = msg
      fire()
    })
    ws.on('open', () => {
      client.waitFor = (pred, timeout = 2000) =>
        new Promise((res, rej) => {
          const w = { pred, resolve: res }
          w.timer = setTimeout(() => {
            client.waiters = client.waiters.filter((x) => x !== w)
            rej(new Error('waitFor timeout'))
          }, timeout)
          client.waiters.push(w)
          fire()
        })
      resolve(client)
    })
    ws.on('error', reject)
  })
}

function makePlayer(c) {
  return {
    send: (msg) => c.ws.send(JSON.stringify(msg)),
  }
}

test('end-to-end: host + player, hidden votes, reveal, escalation blocked', async () => {
  const { server } = createApp()
  await new Promise((r) => server.listen(0, r))
  const port = server.address().port
  const room = 'test-room-1'
  const base = `ws://localhost:${port}/ws?room=${room}`

  const host = await connect(`${base}&memberId=host&name=Host&role=facilitator&host=1`)
  const v1 = await host.waitFor((s) => s.members.length === 1)
  assert.equal(v1.members[0].role, 'facilitator')

  const player = await connect(`${base}&memberId=p1&name=P1&role=player`)
  const v2 = await player.waitFor((s) => s.members.length === 2)
  const hostRow = v2.members.find((m) => m.id === 'host')
  assert.equal(hostRow.vote, null, 'vote hidden while voting')

  makePlayer(player).send({ type: 'reveal' })
  const err = await player.waitFor((x) => x && x.type === 'error', 2000)
  assert.equal(err.message, 'not allowed', 'player cannot trigger reveal')

  makePlayer(host).send({ type: 'addIssue', title: 'Login form' })
  await host.waitFor((s) => s.issues.length === 1)

  makePlayer(host).send({ type: 'setVote', card: '5' })
  makePlayer(player).send({ type: 'setVote', card: '3' })
  await player.waitFor((s) => s.allVotersReady)

  makePlayer(host).send({ type: 'reveal' })
  const revealed = await player.waitFor((s) => s.phase === 'revealed')
  assert.deepEqual(revealed.tally, { 5: 1, 3: 1 })
  const hostRevealed = revealed.members.find((m) => m.id === 'host')
  assert.equal(hostRevealed.vote, '5', 'after reveal, votes are visible')

  host.ws.close()
  player.ws.close()
  server.close()
})

test('joining an unknown room without host flag is rejected', async () => {
  const { server } = createApp()
  await new Promise((r) => server.listen(0, r))
  const port = server.address().port
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?room=nope&memberId=x&role=player`)
    let gotError = false
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'error' && msg.message === 'room not found') gotError = true
    })
    ws.on('close', () => {
      try {
        assert.ok(gotError, 'expected room-not-found error')
        server.close()
        resolve()
      } catch (e) {
        server.close()
        reject(e)
      }
    })
    ws.on('error', (e) => { server.close(); reject(e) })
  })
})
