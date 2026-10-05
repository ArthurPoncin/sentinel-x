import { loadConfig } from './config.js'
import { buildServer } from './server.js'

const config = loadConfig(process.env)
const server = await buildServer(config)
const address = await server.listen({ host: config.host, port: config.port })

console.log(`Command Post API listening on ${address} (mock feed ${config.mockFeed ? 'on' : 'off'})`)
