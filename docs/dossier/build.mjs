#!/usr/bin/env node
// Builds the engineering report: dossier.html + donnees.json + img/ + preuves/
//   → docs/livrables/Workshop2026-M1-G<n>-Dossier.pdf (A4, the A3 poster as its last page).
// Usage: node docs/dossier/build.mjs
// Needs a Chromium: $CHROME, Playwright's cache, or one installed on the system. No npm package.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const data = JSON.parse(readFileSync(join(here, 'donnees.json'), 'utf8'))
const audit = data.audit

// What is still to fill in, listed at the end of the build.
const missing = []
const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const filled = (value) => value !== undefined && value !== null && String(value).trim() !== ''
const todo = (label) => {
  missing.push(label)
  return '<span class="chip todo">à relever</span>'
}
const value = (v, label) => (filled(v) ? escape(v) : todo(label))

const table = filled(data.table) ? String(data.table).trim() : 'X'
const group = filled(data.groupe) ? String(data.groupe).trim() : ''
if (!group) missing.push('donnees.json : groupe (nom du fichier et couverture)')
if (table === 'X') missing.push('donnees.json : table (adresses 192.168.X.x)')

// --- The slots of dossier.html --------------------------------------------------------------

// The wiring section shows img/cablage.* when someone drops one there, a single schema for the whole
// section; otherwise the team's wiring sheets, as cablage.mjs takes them out of docs/cablage.
const wiringFile = ['png', 'jpg', 'jpeg', 'svg', 'webp'].map((ext) => `cablage.${ext}`).find((name) => existsSync(join(here, 'img', name)))
const wiringSheets = !wiringFile && ['cablage-sentinel.svg', 'cablage-pi-ports.svg', 'cablage-pi-gpio.svg'].every((name) => existsSync(join(here, 'img', name)))

function wiring() {
  if (wiringFile) return `<img class="wiring" src="img/${wiringFile}" alt="Schéma de câblage du Sentinel">`
  if (wiringSheets) {
    return `<img class="wire" src="img/cablage-sentinel.svg" alt="Schéma de câblage de l'ESP32 : MQ-2, enceinte, capteur de son et PIR à gauche, DHT22 à droite">
    <figcaption>Le Sentinel sur breadboard, sans soudure. Fiche de câblage de l'équipe : <code>docs/cablage/esp32.html</code>.</figcaption>`
  }
  missing.push('img/cablage.png : le schéma de câblage')
  return `<div class="placeholder"><b>Emplacement du schéma de câblage</b>
    <span>Fichier attendu : docs/dossier/img/cablage.png (ou .jpg, .svg), puis relancer la construction.</span></div>`
}

// The Command Post's two diagrams, on a page of their own with its table.
function wiringPi() {
  if (!wiringSheets) return ''
  return `<figure class="newpage">
    <img class="wire" style="width:150mm" src="img/cablage-pi-ports.svg" alt="Raspberry Pi 4 vu de dessus et ce qui se branche sur chaque port">
    <figcaption>Ce qui se branche sur chaque port du Raspberry Pi 4.</figcaption>
  </figure>
  <figure>
    <img class="wire" style="width:110mm" src="img/cablage-pi-gpio.svg" alt="Connecteur GPIO du Raspberry Pi et carte ULN2003 du moteur pas-à-pas">
    <figcaption>Le moteur pas-à-pas de la caméra sur le connecteur GPIO. Fiche de câblage de l'équipe : <code>docs/cablage/raspberry-pi.html</code>.</figcaption>
  </figure>`
}

const PROOFS = [
  { file: 'nmap-tcp.txt', what: 'Ports TCP', command: `nmap -sS -p- 192.168.${table}.1`, expected: '22, 443 et 8883 ouverts, les 65 532 autres filtrés' },
  { file: 'nmap-udp.txt', what: 'Ports UDP', command: `nmap -sU -p 53,67,68,69,123,137,161,1900,5353 192.168.${table}.1`, expected: '123 ouvert, 67 confirmé par dhcp-discover, aucun autre service' },
  { file: 'checklist-durcissement.txt', what: 'Checklist', command: `cyber/harden.sh ${table} --check`, expected: 'toutes les lignes cochées, y compris après redémarrage' },
]
function proofs() {
  const rows = []
  const outputs = []
  for (const proof of PROOFS) {
    const path = join(here, 'preuves', proof.file)
    const there = existsSync(path)
    if (!there) missing.push(`preuves/${proof.file} : sortie de « ${proof.command} »`)
    rows.push(`<tr><td>${proof.what}</td><td><code>${escape(proof.command)}</code></td><td>${proof.expected}</td>
      <td>${there ? '<span class="chip ok">relevé</span>' : '<span class="chip todo">à relever</span>'}</td></tr>`)
    if (there) outputs.push(`<figure class="proof"><figcaption><code>${escape(proof.command)}</code></figcaption><pre>${escape(readFileSync(path, 'utf8').trimEnd())}</pre></figure>`)
  }
  return `<table class="t"><thead><tr><th style="width:15%">Preuve</th><th style="width:40%">Commande</th><th>Attendu</th><th style="width:13%">État</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table>${outputs.join('')}`
}

function visionPi4() {
  return data.vision_pi4.map((row, index) => {
    const measured = filled(row.p50) && filled(row.p95)
    return `<tr><td>Raspberry Pi 4</td><td>${escape(row.detecteur)}</td>
      <td class="n">${measured ? `${escape(row.p50)} / ${escape(row.p95)}` : todo(`donnees.json : vision_pi4[${index}] (python -m vision.bench sur le Pi)`)}</td></tr>`
  }).join('')
}

function predictiveReal() {
  const real = data.predictif_reel
  const label = 'donnees.json : predictif_reel (résumé de « predictive train », puis démo de dérive)'
  if (!['plage', 'vecteurs', 'niveau_levee', 'niveau_fin', 'avance'].some((key) => filled(real[key]))) {
    return `<tr><td>Capture réelle <span class="sub">(Sentinel)</span></td><td colspan="4">${todo(label)}</td></tr>`
  }
  return `<tr><td>Capture réelle <span class="sub">(Sentinel)</span></td><td>${value(real.plage, label)}</td>
    <td class="n">${value(real.vecteurs, label)}</td><td class="n">${value(real.niveau_levee, label)} / ${value(real.niveau_fin, label)}</td>
    <td>${value(real.avance, label)}</td></tr>`
}

const VERDICTS = { ok: ['ok', 'Conforme'], ecart: ['warn', 'Écart'], ko: ['ko', 'Non conforme'] }
const verdict = (v, label) => (VERDICTS[v] ? `<span class="chip ${VERDICTS[v][0]}">${VERDICTS[v][1]}</span>` : todo(label))

function auditFrame() {
  const label = (field) => `donnees.json : audit.${field}`
  return `<dl class="frame">
    <dt>Date</dt><dd>${value(audit.date, label('date'))}</dd>
    <dt>Auditeurs</dt><dd>${value(audit.auditeurs, label('auditeurs'))}</dd>
    <dt>Table auditée</dt><dd>${value(audit.table_auditee, label('table_auditee'))}</dd>
    <dt>Audités par</dt><dd>${value(audit.audites_par, label('audites_par'))}</dd>
    <dt>Outils</dt><dd>Nmap, Wireshark, Metasploit, openssl s_client, mosquitto_pub et mosquitto_sub, curl</dd>
    <dt>Règles</dt><dd>Tables consentantes du workshop seulement. Ni destruction ni persistance. Déni de service court et annoncé. Aucun secret conservé.</dd>
  </dl>`
}

function auditSummary() {
  const counts = { ok: 0, ecart: 0, ko: 0 }
  for (const row of audit.grille) if (row.verdict in counts) counts[row.verdict] += 1
  const done = counts.ok + counts.ecart + counts.ko
  const tally = done === 0 ? '' : `<p class="tally"><b>${done} tests sur ${audit.grille.length} passés</b> :
    <span class="chip ok">${counts.ok} conformes</span> <span class="chip warn">${counts.ecart} écarts</span> <span class="chip ko">${counts.ko} non conformes</span></p>`
  return `${tally}<p>${value(audit.synthese, 'donnees.json : audit.synthese')}</p>`
}

function auditGrid() {
  return audit.grille.map((row) => `<tr><td class="id">${escape(row.id)}</td><td>${escape(row.test)}</td><td>${escape(row.attendu)}</td>
    <td>${filled(row.observe) ? escape(row.observe) : ''}</td><td>${verdict(row.verdict, `donnees.json : audit.grille ${row.id}`)}</td></tr>`).join('')
}

function auditOffensive() {
  return audit.offensif.map((step, index) => {
    const label = `donnees.json : audit.offensif[${index}] (${step.etape})`
    return `<tr><td class="id">${index + 1}</td><td>${escape(step.etape)}</td><td>${value(step.tente, label)}</td><td>${filled(step.resultat) ? escape(step.resultat) : ''}</td></tr>`
  }).join('')
}

function auditFindings() {
  if (audit.constats.length === 0) return `<tr><td colspan="6">${todo('donnees.json : audit.constats (ou "aucun_constat": true)')}</td></tr>`
  return audit.constats.map((finding) => `<tr><td class="id">${escape(finding.id ?? '')}</td><td>${escape(finding.systeme ?? '')}</td>
    <td>${escape(finding.criticite ?? '')}</td><td>${escape(finding.constat ?? '')}</td><td>${escape(finding.correctif ?? '')}</td><td>${escape(finding.etat ?? '')}</td></tr>`).join('')
}

const slots = {
  cablage: wiring,
  cablage_pi: wiringPi,
  preuves: proofs,
  vision_pi4: visionPi4,
  predictif_reel: predictiveReal,
  audit_cadre: auditFrame,
  audit_synthese: auditSummary,
  audit_grille: auditGrid,
  audit_offensif: auditOffensive,
  audit_constats: () => (audit.aucun_constat === true ? '<tr><td colspan="6">Aucun constat : aucun écart relevé, ni chez nous ni sur la table auditée.</td></tr>' : auditFindings()),
  audit_conclusion: () => `<p>${value(audit.conclusion, 'donnees.json : audit.conclusion')}</p>`,
}

const tokens = {
  T: table,
  G: group || 'n',
  GROUPE: group ? `Groupe G${escape(group)}` : 'Groupe à renseigner',
  MOTEUR_GPIO: filled(data.moteur_gpio) ? escape(data.moteur_gpio) : 'quatre GPIO du Pi, repérés sur le schéma',
  NOTE_X: table === 'X' ? ' X est le numéro de la table.' : '',
}

// --- Assemble -------------------------------------------------------------------------------

let html = readFileSync(join(here, 'dossier.html'), 'utf8')
html = html.replace(/<!--SLOT:([a-z0-9_]+)-->/g, (_, name) => {
  if (!slots[name]) throw new Error(`dossier.html : emplacement inconnu « ${name} »`)
  return slots[name]()
})
html = html.replace(/\{\{([A-Z_]+)\}\}/g, (_, name) => {
  if (!(name in tokens)) throw new Error(`dossier.html : jeton inconnu « ${name} »`)
  return tokens[name]
})

// French spacing: a no-break space before : ; ? ! » and after «, in the text only (not in the styles).
const bodyAt = html.indexOf('<body')
const french = (text) => text.replace(/ ([:;?!»])/g, '\u00a0$1').replace(/« /g, '«\u00a0')
html = html.slice(0, bodyAt) + html.slice(bodyAt).replace(/>([^<]+)</g, (_, text) => `>${french(text)}<`)

if (/[\u2013\u2014]/.test(html.slice(bodyAt))) console.warn('Attention : un tiret long (demi-cadratin ou cadratin) est resté dans le texte.')

function chromium() {
  const candidates = [process.env.CHROME]
  const cache = join(homedir(), '.cache', 'ms-playwright')
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).sort().reverse()) {
      candidates.push(join(cache, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell'), join(cache, dir, 'chrome-linux64', 'chrome'))
    }
  }
  candidates.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  return candidates.find((path) => path && existsSync(path))
}

const browser = chromium()
if (!browser) {
  console.error('Aucun Chromium trouvé. Indique le tien : CHROME=/chemin/vers/chrome node docs/dossier/build.mjs')
  process.exit(1)
}

const outDir = join(here, '..', 'livrables')
mkdirSync(outDir, { recursive: true })
const out = join(outDir, `Workshop2026-M1-G${group || 'X'}-Dossier.pdf`)
// Next to dossier.html, so that its relative paths (img/…) still resolve.
const page = join(here, '.dossier.build.html')
writeFileSync(page, html)
try {
  const flags = ['--headless', '--disable-gpu', '--no-pdf-header-footer', '--generate-pdf-document-outline', `--print-to-pdf=${out}`]
  try {
    execFileSync(browser, [...flags, pathToFileURL(page).href], { stdio: 'pipe' })
  } catch {
    execFileSync(browser, [...flags, '--no-sandbox', pathToFileURL(page).href], { stdio: 'pipe' })
  }
} finally {
  rmSync(page, { force: true })
}
// Once the group is known, the draft named GX is no longer the deliverable.
if (group) rmSync(join(outDir, 'Workshop2026-M1-GX-Dossier.pdf'), { force: true })

console.log(`Écrit : ${out}`)
if (missing.length > 0) {
  console.log(`\nReste à compléter (${missing.length}) :`)
  for (const item of [...new Set(missing)]) console.log(`  - ${item}`)
} else {
  console.log('Rien ne reste à compléter.')
}
