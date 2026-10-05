// Prints the OPERATOR_PASSWORD_HASH of a password read from the terminal (not echoed) or a pipe:
//   npm run -s hash-password
//   printf %s "$PASSWORD" | npm run -s hash-password
import { text } from 'node:stream/consumers'
import { hashPassword } from './auth.js'

async function readHidden(): Promise<string> {
  const input = process.stdin
  process.stderr.write('Operator password: ')
  input.setRawMode(true)
  input.setEncoding('utf8')
  let password = ''
  for await (const chunk of input) {
    for (const char of chunk as string) {
      if (char === '\u0003') process.exit(130)
      if (char === '\r' || char === '\n') {
        input.setRawMode(false)
        input.pause()
        process.stderr.write('\n')
        return password
      }
      password = char === '\u007f' ? password.slice(0, -1) : password + char
    }
  }
  return password
}

const password = process.stdin.isTTY ? await readHidden() : (await text(process.stdin)).replace(/\r?\n$/, '')
if (password.length < 12) {
  console.error('Choose a password of 12 characters or more.')
  process.exit(1)
}
console.log(await hashPassword(password))
