/**
 * Servidor S3 de teste (moto_server, do pacote Python "moto[server]").
 * Se não estiver instalado, os testes de S3 são pulados.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'

const freePort = () =>
  new Promise<number>((ok) => {
    const s = createServer().listen(0, () => {
      const p = (s.address() as { port: number }).port
      s.close(() => ok(p))
    })
  })

export const hasMoto = () => spawnSync('which', ['moto_server']).status === 0

export async function startFakeS3(bucket: string) {
  const port = await freePort()
  const proc: ChildProcess = spawn('moto_server', ['-p', String(port)], { stdio: 'ignore' })
  const endpoint = `http://127.0.0.1:${port}`
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${endpoint}/moto-api/`)
      if (r.ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 150))
  }
  // cria o bucket (moto aceita sem assinatura)
  const r = await fetch(`${endpoint}/${bucket}`, { method: 'PUT' })
  if (!r.ok) throw new Error(`moto: não criou o bucket (${r.status})`)
  return { endpoint, stop: () => proc.kill() }
}
