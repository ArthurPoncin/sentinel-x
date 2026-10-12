#!/usr/bin/env node
// Measured brute force on the Command Post login, for the live demo and the pentest (PENTEST-PLAN.md,
// scenario D14). A teammate runs it from another laptop against our own Command Post, a consenting
// target, and the jury watches the Twin raise its cyber Alert. Node >= 22 only, no dependency, so it
// runs as is on the team's Windows, macOS and Linux laptops.
import { readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { rootCertificates } from 'node:tls'
import { pathToFileURL } from 'node:url'

const LOGIN_PATH = '/api/v1/auth/login'

// Posts one wrong password to the login and resolves with its HTTP status, or an error when the
// request never got an answer (a refused TLS handshake among them).
function postLogin(url, password, agent) {
  return new Promise((resolve) => {
    const client = url.protocol === 'https:' ? https : http
    const body = JSON.stringify({ password })
    const request = client.request(
      url,
      { method: 'POST', agent, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
      (response) => {
        response.resume()
        resolve({ status: response.statusCode })
      },
    )
    request.on('error', (error) => resolve({ error }))
    request.end(body)
  })
}

// An HTTPS agent that trusts the team CA on top of the public roots, with TLS verification left on:
// the demo proves the dome reacts, never that we would talk to an unverified server.
function agentFor(target, caFile) {
  if (target.protocol !== 'https:') return undefined
  const ca = [...rootCertificates]
  if (caFile !== undefined) ca.push(readFileSync(caFile, 'utf8'))
  return new https.Agent({ ca })
}

// Sends wrong logins to `target` at `ratePerSec` for `durationMs`, then stops by itself and resolves
// with how many it sent and how many came back 401 or 429. `caFile` adds the team CA (HTTPS targets).
export function bruteForceLogin({ target, ratePerSec, durationMs, caFile }) {
  const url = new URL(LOGIN_PATH, target)
  const agent = agentFor(url, caFile)
  const intervalMs = 1000 / ratePerSec
  const summary = { attempts: 0, refused401: 0, refused429: 0, other: 0 }

  const count = ({ status }) => {
    if (status === 401) summary.refused401++
    else if (status === 429) summary.refused429++
    else summary.other++
  }

  return new Promise((resolve) => {
    const inFlight = new Set()
    const fire = () => {
      const attempt = postLogin(url, `wrong-${summary.attempts}`, agent).then((result) => {
        count(result)
        inFlight.delete(attempt)
      })
      summary.attempts++
      inFlight.add(attempt)
    }

    const startedAt = Date.now()
    fire()
    const ticking = setInterval(() => {
      if (Date.now() - startedAt < durationMs) fire()
      else {
        clearInterval(ticking)
        Promise.all(inFlight).then(() => resolve(summary))
      }
    }, intervalMs)
  })
}

function parseArgs(argv) {
  const [target] = argv
  const options = { ratePerSec: 10, durationMs: 5000, caFile: undefined }
  for (let i = 1; i < argv.length; i += 2) {
    const value = argv[i + 1]
    if (argv[i] === '--rate') options.ratePerSec = Number(value)
    else if (argv[i] === '--duration') options.durationMs = Number(value) * 1000
    else if (argv[i] === '--ca') options.caFile = value
  }
  return { target, ...options }
}

const USAGE = `Usage: cyber/brute-login.mjs <target-url> [--rate <per-second>] [--duration <seconds>] [--ca <ca.pem>]

  <target-url>   e.g. https://192.168.4.1 (the login is posted to <target-url>${LOGIN_PATH})
  --rate         wrong logins per second (default 10)
  --duration     how long to run, in seconds (default 5)
  --ca           PEM of the team CA to trust, added to the public roots; TLS stays verified`

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.target === undefined || args.target.startsWith('--')) {
    console.error(USAGE)
    process.exit(2)
  }
  console.log(`Brute force on ${new URL(LOGIN_PATH, args.target)} at ${args.ratePerSec}/s for ${args.durationMs / 1000}s`)
  const { attempts, refused401, refused429, other } = await bruteForceLogin(args)
  console.log(`\n${attempts} attempts sent`)
  console.log(`  ${refused401} refused 401 (wrong password)`)
  console.log(`  ${refused429} refused 429 (rate limit)`)
  if (other > 0) console.log(`  ${other} neither (unreachable, TLS refused, or unexpected)`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
