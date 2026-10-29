import 'dotenv/config'
import { buildApp } from './app.js'
import { startMailPoller } from './services/mailbox.js'

const app = await buildApp({ logger: true })
const port = Number(process.env.PORT ?? 3333)
await app.listen({ port, host: '0.0.0.0' })
startMailPoller((msg) => app.log.info(msg))
