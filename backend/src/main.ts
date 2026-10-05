import { loadConfig } from './config.js'
import { openSqliteHistory } from './history.js'
import { buildServer } from './server.js'

const config = loadConfig(process.env)
const history = openSqliteHistory(config.historyFile)
const server = await buildServer({ ...config, history })
const address = await server.listen({ host: config.host, port: config.port })

const mockFeed = `mock feed ${config.mockFeed ? 'on' : 'off'}`
const mqtt = `MQTT ${config.mqtt ? 'on' : 'off'}`
const cors = `CORS ${config.corsOrigins.length > 0 ? config.corsOrigins.join(' ') : 'off'}`
console.log(`Command Post API listening on ${address} (${mockFeed}, ${mqtt}, ${cors}, history in ${config.historyFile})`)

// `docker compose stop` sends SIGTERM: leave the broker and close the history file before going.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    console.log(`Command Post API: ${signal}, shutting down`)
    await server.close()
    history.close()
    process.exit(0)
  })
}
