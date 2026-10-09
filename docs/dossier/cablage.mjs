#!/usr/bin/env node
// Takes the wiring diagrams out of the team's wiring sheets (docs/cablage/*.html) and writes each as a
// standalone SVG in img/, where build.mjs picks them up. Run it again when a sheet changes.
// Usage: node docs/dossier/cablage.mjs [git ref]
//   no ref: the sheets of the working tree; with one (origin/main): the sheets of that ref.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const ref = process.argv[2]

// A diagram: its sheet, the id of its <title>, the part of it the dossier shows, and the words that only
// make sense on the sheet (a card the dossier does not carry, the reader spoken to as a teammate).
const DIAGRAMS = [
  {
    sheet: 'esp32.html', title: 'schema-title', viewBox: '28 74 1284 860', out: 'cablage-sentinel.svg',
    reword: [['(encadré « Moteur »)', '(schéma du Command Post)'], ['grille face à toi', 'grille de face']],
  },
  { sheet: 'raspberry-pi.html', title: 'ports-title', viewBox: '60 40 1020 598', out: 'cablage-pi-ports.svg', reword: [] },
  { sheet: 'raspberry-pi.html', title: 'gpio-title', viewBox: '58 8 760 688', out: 'cablage-pi-gpio.svg', reword: [] },
]

// The dossier's own fonts and a white sheet: the sheets ask Google Fonts for theirs, an image may not.
const PRINT = `:root { --paper: #fff; --f-display: 'Inter', sans-serif; --f-body: 'Inter', sans-serif;
  --f-mono: 'JetBrains Mono', 'JetBrainsMono Nerd Font', monospace; }`

const sheets = new Map()
function sheet(name) {
  if (!sheets.has(name)) {
    const path = `docs/cablage/${name}`
    sheets.set(name, ref
      ? execFileSync('git', ['show', `${ref}:${path}`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 24 })
      : readFileSync(join(repo, path), 'utf8'))
  }
  return sheets.get(name)
}

for (const diagram of DIAGRAMS) {
  const html = sheet(diagram.sheet)
  const css = html.match(/<style>\s*(\/\*[\s\S]*?)<\/style>/)?.[1]
  const svg = html.match(new RegExp(`<svg[^>]*aria-labelledby="${diagram.title}"[^>]*>([\\s\\S]*?)</svg>`))?.[1]
  if (!css || !svg) throw new Error(`${diagram.sheet} : schéma « ${diagram.title} » introuvable, la fiche a changé`)

  // The grid and its paper stay on the sheet: the dossier prints the diagram on white.
  let drawing = svg
    .replace(/<defs>[\s\S]*?<\/defs>/, '')
    .replace(/<rect[^>]*class="paper"[^>]*\/>/, '')
    .replace(/<rect[^>]*fill="url\(#grid\)"[^>]*\/>/, '')
  for (const [from, to] of diagram.reword) {
    if (!drawing.includes(from)) console.warn(`${diagram.sheet} : « ${from} » n'y est plus, rien à reformuler`)
    drawing = drawing.replace(from, to)
  }

  writeFileSync(join(here, 'img', diagram.out), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${diagram.viewBox}" role="img" aria-labelledby="${diagram.title}">
<style><![CDATA[
${css.trim()}
${PRINT}
]]></style>
${drawing.trim()}
</svg>
`)
  console.log(`Écrit : img/${diagram.out}`)
}
