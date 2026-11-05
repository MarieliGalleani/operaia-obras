import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasMoto, startFakeS3 } from '../dev/fake-s3.js'
import { diskStorage, listLocalKeys, s3Storage, signV4, toKey, type Storage } from './storage.js'

describe('assinatura S3 (AWS Signature v4)', () => {
  it('bate com o exemplo oficial da AWS (GET Object)', () => {
    // docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html — "Example: GET Object"
    const { signature } = signV4({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      headers: { range: 'bytes=0-9', 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'x-amz-date': '20130524T000000Z' },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    })
    expect(signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
  })
})

describe('chave do arquivo', () => {
  it('converte caminhos antigos e recusa caminhos perigosos', () => {
    expect(toKey('storage/abc/2026-11/x.xml')).toBe('abc/2026-11/x.xml')
    expect(toKey('./storage/abc/x.xml')).toBe('abc/x.xml')
    expect(toKey('/app/storage/abc/x.xml')).toBe('abc/x.xml')
    expect(toKey('media/obras/f.jpg')).toBe('media/obras/f.jpg')
    expect(() => toKey('../etc/passwd')).toThrow()
    expect(() => toKey('a/../../b')).toThrow()
  })
})

async function contract(st: Storage) {
  const key = 'empresa-1/2026-11/abc123-NFe Ação (1).xml'
  const body = Buffer.from('<nfeProc>ção</nfeProc>')
  expect(await st.exists(key)).toBe(false)
  expect(await st.get(key)).toBeNull()
  await st.put(key, body, 'application/xml')
  expect(await st.exists(key)).toBe(true)
  expect((await st.get(key))!.equals(body)).toBe(true)
  const big = Buffer.alloc(3 * 1024 * 1024, 7)
  await st.put('media/obras/grande.jpg', big)
  expect((await st.get('media/obras/grande.jpg'))!.length).toBe(big.length)
  await st.delete(key)
  expect(await st.exists(key)).toBe(false)
  await st.delete(key) // apagar de novo não dá erro
}

describe('armazenamento em disco', () => {
  let dir = ''
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'operaia-st-'))
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))
  it('grava, lê, confere e apaga', async () => {
    const st = diskStorage(dir)
    await contract(st)
    expect(await listLocalKeys(dir)).toEqual(['media/obras/grande.jpg'])
  })
})

describe.skipIf(!hasMoto())('armazenamento S3 (servidor S3 de teste)', () => {
  let s3: Awaited<ReturnType<typeof startFakeS3>>
  beforeAll(async () => {
    s3 = await startFakeS3('operaia-teste')
  }, 20_000)
  afterAll(() => s3?.stop())

  const make = (secret = 'segredo') =>
    s3Storage({ endpoint: s3.endpoint, region: 'us-east-1', bucket: 'operaia-teste', accessKeyId: 'teste', secretAccessKey: secret, pathStyle: true })

  it('grava, lê, confere e apaga', async () => {
    await contract(make())
  })
})
