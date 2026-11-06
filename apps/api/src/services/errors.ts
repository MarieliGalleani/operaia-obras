export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} não encontrado(a)`)
export const badRequest = (code: string, message: string, details?: unknown) => new AppError(400, code, message, details)
export const forbidden = (message: string) => new AppError(403, 'SEM_PERMISSAO', message)
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details)
