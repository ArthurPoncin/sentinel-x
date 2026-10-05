import { loadConfig } from './config.js'
import { openSqliteHistory } from './history.js'
import { buildServer } from './server.js'

const config = loadConfig(process.env)
const history = openSqliteHistory(config.historyFile)
const server = await buildServer({ ...config, history })
const address = await server.listen({ host: config.host, port: config.port })

const mockFeed = `mock feed ${config.mockFeed ? 'on' : 'off'}`
const mqtt = `MQTT ${config.mqtt ? 'on' : 'off'}`
console.log(`Command Post API listening on ${address} (${mockFeed}, ${mqtt}, history in ${config.historyFile})`)
