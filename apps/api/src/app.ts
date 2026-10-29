import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import path from 'node:path'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { AppError } from './services/errors.js'
import { registerRoutes } from './routes.js'

export interface AuthUser {
  sub: string
  companyId: string
  role: 'ADMIN' | 'FINANCEIRO' | 'GESTOR_OBRA'
  name: string
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser
    user: AuthUser
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

export async function buildApp(opts: { logger?: boolean } = {}) {
  const isProd = process.env.NODE_ENV === 'production'
  const secret = process.env.JWT_SECRET ?? 'dev-secret'
  if (isProd && (secret === 'dev-secret' || secret.length < 32)) {
    throw new Error('JWT_SECRET precisa ter pelo menos 32 caracteres em produção (gere com: openssl rand -hex 32)')
  }

  // atrás do proxy da VPS: confia no X-Forwarded-For para IP real (limite de tentativas) e protocolo
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 10 * 1024 * 1024, trustProxy: true })

  await app.register(rateLimit, { global: false })
  if (process.env.CORS_ORIGIN) {
    await app.register(cors, { origin: process.env.CORS_ORIGIN.split(','), credentials: true })
  } else if (!isProd) {
    await app.register(cors, { origin: 'http://localhost:5173', credentials: true })
  }
  await app.register(jwt, { secret, sign: { expiresIn: '12h' } })
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 50 } })

  // XML cru (integrações): aceita application/xml e text/xml como Buffer
  app.addContentTypeParser(['application/xml', 'text/xml'], { parseAs: 'buffer' }, (_req, body, done) => done(null, body))

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify()
    } catch {
      return reply.code(401).send({ code: 'NAO_AUTENTICADO', message: 'Faça login para continuar.' })
    }
  })

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message, details: err.details })
    if (err instanceof ZodError) return reply.code(400).send({ code: 'VALIDACAO', message: 'Dados inválidos', details: err.issues })
    const e = err as { statusCode?: number; message: string }
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ code: 'REQUISICAO', message: e.message })
    app.log.error(err)
    return reply.code(500).send({ code: 'ERRO_INTERNO', message: 'Erro inesperado. Tente novamente.' })
  })

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  })

  app.get('/api/health', async () => ({ status: 'up' }))
  await registerRoutes(app)

  // Em produção a API também entrega as telas (build do front), num único processo/porta
  const webDist = process.env.WEB_DIST ? path.resolve(process.env.WEB_DIST) : null
  if (webDist && existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false, maxAge: '1h' })
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.header('Cache-Control', 'no-cache').sendFile('index.html')
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Rota não encontrada' })
    })
  }
  return app
}
