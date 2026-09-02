#!/usr/bin/env node
// Локальный сервер дашборда: статика + POST /api/refresh.
//
// Node-версия serve.py — существует только чтобы обойти ограничение macOS,
// из-за которого системный python3 (Command Line Tools) не может быть
// запущен напрямую harness'ом превью-панели в папке Downloads (Errno 1:
// Operation not permitted), хотя тот же python3 прекрасно работает при
// запуске из обычного терминала. Node этому ограничению не подвержен,
// поэтому сам HTTP-сервер здесь на Node, а fetch_data.py (Python, ему
// нужны requests/google-auth) по-прежнему вызывается как подпроцесс —
// это уже работает нормально, ограничение бьёт только по прямому запуску.
//
// Запуск: node serve.mjs  →  http://localhost:8765/dashboard.html

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8765)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function handleRefresh(res) {
  const py = spawn('python3', ['fetch_data.py'], { cwd: DIR })
  let stderr = ''
  py.stderr.on('data', d => { stderr += d })
  py.on('error', err => {
    res.writeHead(500); res.end(String(err))
  })
  py.on('close', async code => {
    if (code !== 0) {
      res.writeHead(500); res.end(stderr || `fetch_data.py exited with code ${code}`)
      return
    }
    try {
      const body = await readFile(path.join(DIR, 'dashboard_data.json'))
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(body)
    } catch (err) {
      res.writeHead(500); res.end(String(err))
    }
  })
}

async function handleStatic(req, res) {
  const reqPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const rel = reqPath === '/' ? '/dashboard.html' : reqPath
  const filePath = path.normalize(path.join(DIR, rel))
  if (!filePath.startsWith(DIR)) { res.writeHead(403); res.end(); return }
  try {
    const s = await stat(filePath)
    if (!s.isFile()) throw new Error('not a file')
    const body = await readFile(filePath)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404); res.end('Not found')
  }
}

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/refresh') { handleRefresh(res); return }
  handleStatic(req, res)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`http://localhost:${PORT}/dashboard.html`)
})
