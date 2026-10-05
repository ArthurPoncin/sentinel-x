import { loadConfig } from './config.js'
import { buildServer } from './server.js'

const config = loadConfig(process.env)
const server = await buildServer(config)
const address = await server.listen({ host: config.host, port: config.port })

const mockFeed = `mock feed ${config.mockFeed ? 'on' : 'off'}`
const mqtt = `MQTT ingress ${config.mqtt ? 'on' : 'off'}`
console.log(`Command Post API listening on ${address} (${mockFeed}, ${mqtt})`)
