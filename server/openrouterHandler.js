import { Buffer } from 'node:buffer'
import process from 'node:process'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = 'meta-llama/llama-3.3-70b-instruct'
const MAX_BODY_BYTES = 160_000
const MAX_MESSAGE_LENGTH = 100_000
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const RATE_LIMIT_REQUESTS = 20
const requestCounts = new Map()

function sendJson(response, status, payload) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(payload))
}

async function readRequestBody(request) {
  if (request.body !== undefined) {
    const body = typeof request.body === 'string'
      ? request.body
      : JSON.stringify(request.body)
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      throw new Error('Request body is too large.')
    }
    return typeof request.body === 'object' && request.body !== null
      ? request.body
      : JSON.parse(body)
  }

  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > MAX_BODY_BYTES) {
      throw new Error('Request body is too large.')
    }
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 4) {
    throw new Error('Send between one and four chat messages.')
  }

  const totalLength = messages.reduce((total, message) => {
    if (
      !message ||
      !['system', 'user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string' ||
      !message.content.trim()
    ) {
      throw new Error('Each chat message needs a valid role and non-empty text.')
    }
    return total + message.content.length
  }, 0)

  if (totalLength > MAX_MESSAGE_LENGTH) {
    throw new Error('The screenplay is too long to analyze. Reduce the script length and try again.')
  }

  return messages.map(({ role, content }) => ({ role, content }))
}

function isSameOriginRequest(request) {
  const origin = request.headers.origin
  const host = request.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false

  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase()
  } catch {
    return false
  }
}

function isRateLimited(request) {
  const forwardedFor = request.headers['x-forwarded-for']
  const clientIp = typeof forwardedFor === 'string'
    ? forwardedFor.split(',')[0].trim()
    : request.socket?.remoteAddress || 'unknown'
  const now = Date.now()
  const current = requestCounts.get(clientIp)

  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    requestCounts.set(clientIp, { startedAt: now, count: 1 })
    return false
  }
  if (current.count >= RATE_LIMIT_REQUESTS) return true

  current.count += 1
  return false
}

export async function handleOpenRouterRequest(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return sendJson(response, 405, { error: 'Method not allowed.' })
  }

  if (!isSameOriginRequest(request)) {
    return sendJson(response, 403, { error: 'Requests must come from this application.' })
  }

  if (isRateLimited(request)) {
    response.setHeader('Retry-After', String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)))
    return sendJson(response, 429, { error: 'Too many AI requests. Please try again in 15 minutes.' })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return sendJson(response, 503, { error: 'OpenRouter is not configured on the server.' })
  }

  let body
  let messages
  try {
    body = await readRequestBody(request)
    messages = validateMessages(body?.messages)
    if (body?.temperature !== undefined && (
      typeof body.temperature !== 'number' ||
      !Number.isFinite(body.temperature) ||
      body.temperature < 0 ||
      body.temperature > 2
    )) {
      throw new Error('Temperature must be a number between 0 and 2.')
    }
  } catch (error) {
    return sendJson(response, 400, { error: error.message || 'Invalid request.' })
  }

  try {
    const upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': `https://${request.headers.host}`,
        'X-Title': 'AI Scriptify',
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: body.temperature ?? 0.9,
      }),
      signal: AbortSignal.timeout(60_000),
    })

    const responseBody = await upstream.text()
    response.statusCode = upstream.status
    response.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    response.setHeader('Cache-Control', 'no-store')
    response.end(responseBody)
  } catch (error) {
    console.error('OpenRouter request failed:', error)
    sendJson(response, 502, { error: 'Could not reach OpenRouter. Please try again.' })
  }
}
