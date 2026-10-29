import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
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
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 10 * 1024 * 1024 })

  await app.register(cors, { origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','), credentials: true })
  await app.register(jwt, { secret: process.env.JWT_SECRET ?? 'dev-secret', sign: { expiresIn: '12h' } })
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

  app.get('/api/health', async () => ({ status: 'up' }))
  await registerRoutes(app)
  return app
}
