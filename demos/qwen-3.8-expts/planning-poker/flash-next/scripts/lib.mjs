import net from 'node:net'
import http from 'node:http'
import { WebSocket } from 'ws'

// Default 8788 (not 8787 — that is wrangler/workerd's default and commonly taken).
export const WS_PORT = Number(process.env.WS_PORT || 8788)
export const WEB_PORT = Number(process.env.WEB_PORT || 5173)

export function log(scope, msg) {
  console.log(`[${scope}] ${msg}`)
}

// Resolves true if a TCP listener accepts a connection on the port.
export function tcpOpen(port, host = '127.0.0.1', timeout = 800) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host })
    const done = (v) => { sock.destroy(); resolve(v) }
    sock.setTimeout(timeout)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

// Resolves true when the port hosts a WebSocket server that completes the
// /ws handshake (the signature of our planning-poker server; a foreign TCP
// service never completes a WS handshake, so this distinguishes "ours" from
// "someone else is using this port").
export function isWsServerUp(port, timeout = 1000) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (v) => { if (!settled) { settled = true; try { ws.close() } catch {} resolve(v) } }
    let ws
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    } catch {
      return finish(false)
    }
    const timer = setTimeout(() => finish(false), timeout)
    ws.once('open', () => { clearTimeout(timer); finish(true) })
    ws.once('message', () => { clearTimeout(timer); finish(true) })
    ws.once('error', () => { clearTimeout(timer); finish(false) })
    ws.once('close', () => { clearTimeout(timer); finish(false) })
  })
}

export function httpGet(url, timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function waitForWsServer(port, deadlineMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < deadlineMs) {
    if (await isWsServerUp(port)) return true
    await sleep(150)
  }
  return false
}