// The catalogue snapshot of the Create tab, taken over from the web checkout.
//
// Three files under src/lib/render hold it: the studio models, the field
// schema of every model, and which schema a classic model reads per variant.
// The web keeps them in the words of the service that renders: each model
// carries the path it runs on there, and the schemas are filed under those
// paths. The app sends none of that anywhere. It needs a key to find the
// schema of a model, and the fields under it. So this script takes the three
// files over with three changes, line by line, and leaves every other byte
// alone:
//
//   1. A path whose first segment names the service itself gets HOUSE as its
//      first segment instead. "Names the service" is what the vendor rule of
//      scripts/check-silent.mjs matches, so this file spells no name. The rest
//      of the path stays, which keeps the keys stable and the step reversible:
//      whoever knows that segment puts it back in front. Applied to the three
//      places a path stands in: the `endpoint` of a model, a key of the schema
//      file, a variant of a classic model.
//   2. A hint (`description`, `x-hint`) loses a web address in brackets and
//      the name of a file store. The web makes the same two cuts for its own
//      pages. Fields, types, limits, choices and defaults are not touched.
//   3. A `label` carries the app's word for the open models where the web
//      carries its own (src/lib/unfiltered-mark.ts on both sides).
//
// What the service is paid per run stays in the files as it is.
//
//   LU_WEB_REPO=<web checkout> node scripts/studio-snapshot.mjs          write
//   LU_WEB_REPO=<web checkout> node scripts/studio-snapshot.mjs --check  compare
//
// src/lib/render/__tests__/studio-contract.test.ts runs the same transform and
// fails when a file on disk is not what this script writes.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RULES, findHits } from './check-silent.mjs'

const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DESKTOP_DIR = 'src/lib/render'
const WEB_DIR = 'apps/web/lib/render'
const MARK_FILE = 'lib/unfiltered-mark.ts'

export const SNAPSHOT_FILES = ['studio-models.json', 'provider-schemas.json', 'provider-endpoints.json']

/** What stands in front of a path instead of the name of the service. */
export const HOUSE = 'base'

const SERVICE = RULES.find((rule) => rule.id === 'vendor').re

/** The lines of each file a path stands in. The first group is everything in
 *  front of the path, the second its first segment, the third the rest. */
const PATH_LINES = {
  'studio-models.json': /^(\s+"endpoint": ")([^"/]+)(\/[^"]+",?)$/,
  'provider-schemas.json': /^( {2}")([^"/]+)(\/[^"]+": \{)$/,
  'provider-endpoints.json': /^( {4}"\w+": ")([^"/]+)(\/[^"]+",?)$/,
}

const HINT_LINE = /^\s+"(description|x-hint)": "/
const HINT_CUTS = [
  [/\s*\(https?:\/\/[^)\s]*\)/g, ''],
  [/ after re-uploading to [A-Za-z]+ CDN/g, ''],
]

/** One file of the snapshot without the name of the service.
 *  @param {string} name @param {string} text @returns {string} */
export function neutralText(name, text) {
  const pathLine = PATH_LINES[name]
  if (!pathLine) throw new Error(`studio-snapshot: ${name} is not a file of the snapshot`)
  return text.split('\n').map((line) => {
    const path = pathLine.exec(line)
    if (path) return SERVICE.test(`${path[2]}/`) ? `${path[1]}${HOUSE}${path[3]}` : line
    if (name === 'provider-schemas.json' && HINT_LINE.test(line)) {
      return HINT_CUTS.reduce((cut, [from, to]) => cut.replace(from, to), line)
    }
    return line
  }).join('\n')
}

/** The model file with the app's word in its names. Only `label` lines.
 *  @param {string} text @param {string} webWord @param {string} desktopWord @returns {string} */
export function desktopLabels(text, webWord, desktopWord) {
  return text.split('\n').map((line) => (/^\s*"label": /.test(line) ? line.split(webWord).join(desktopWord) : line)).join('\n')
}

/** Throws unless the three texts are a snapshot the app can read: every model
 *  and every variant finds its schema, no two paths fell onto one key, and no
 *  line names the service. The last one fails when a new hint does; then
 *  HINT_CUTS has to learn it.
 *  @param {Record<string, string>} texts @param {number} [sourceKeys] */
export function checkSnapshot(texts, sourceKeys) {
  const models = JSON.parse(texts['studio-models.json'])
  const schemas = JSON.parse(texts['provider-schemas.json'])
  const endpoints = JSON.parse(texts['provider-endpoints.json'])
  if (sourceKeys !== undefined && Object.keys(schemas).length !== sourceKeys) {
    throw new Error(`studio-snapshot: ${sourceKeys} schemas went in, ${Object.keys(schemas).length} came out. Two paths fell onto one key.`)
  }
  for (const [id, model] of Object.entries(models)) {
    if (!schemas[model.endpoint]) throw new Error(`studio-snapshot: no schema for ${id}`)
  }
  for (const [id, variants] of Object.entries(endpoints)) {
    for (const [variant, path] of Object.entries(variants)) {
      if (!schemas[path]) throw new Error(`studio-snapshot: no schema for ${id} ${variant}`)
    }
  }
  const named = SNAPSHOT_FILES.flatMap((name) => findHits(texts[name], `${DESKTOP_DIR}/${name}`).filter((hit) => hit.rule === 'vendor'))
  if (named.length > 0) {
    throw new Error(`studio-snapshot: the snapshot would still name the service: ${named.slice(0, 5).map((hit) => `${hit.file}:${hit.line}`).join(', ')}`)
  }
}

function markWord(file) {
  const found = /export const STATEMENT_MARK_LABEL =\s*\n?\s*(['"])(.*)\1/.exec(readFileSync(file, 'utf8'))
  if (!found || !found[2]) throw new Error(`studio-snapshot: no word for the open models in ${file}`)
  return found[2]
}

/** The three files as the app carries them, built from a web checkout.
 *  @param {string} webRepo @param {string} [desktopRoot] @returns {Record<string, string>} */
export function snapshotFromWeb(webRepo, desktopRoot = DESKTOP_ROOT) {
  const webWord = markWord(resolve(webRepo, 'apps/web', MARK_FILE))
  const desktopWord = markWord(resolve(desktopRoot, 'src', MARK_FILE))
  /** @type {Record<string, string>} */
  const texts = {}
  let sourceKeys
  for (const name of SNAPSHOT_FILES) {
    const web = readFileSync(resolve(webRepo, WEB_DIR, name), 'utf8')
    if (web.split('\n').some((line) => PATH_LINES[name].exec(line)?.[2] === HOUSE)) {
      throw new Error(`studio-snapshot: ${name} of the web already has a path under "${HOUSE}/", the step would not be reversible`)
    }
    if (name === 'provider-schemas.json') sourceKeys = Object.keys(JSON.parse(web)).length
    const neutral = neutralText(name, web)
    texts[name] = name === 'studio-models.json' ? desktopLabels(neutral, webWord, desktopWord) : neutral
  }
  checkSnapshot(texts, sourceKeys)
  return texts
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const webRepo = process.env.LU_WEB_REPO?.trim() || process.argv.slice(2).find((arg) => !arg.startsWith('--'))
  if (!webRepo) {
    process.stderr.write('studio-snapshot: set LU_WEB_REPO to the web checkout, or pass its path.\n')
    process.exit(2)
  }
  const check = process.argv.includes('--check')
  const texts = snapshotFromWeb(resolve(webRepo))
  let differ = 0
  for (const name of SNAPSHOT_FILES) {
    const file = resolve(DESKTOP_ROOT, DESKTOP_DIR, name)
    const same = readFileSync(file, 'utf8') === texts[name]
    if (!same) differ++
    if (!same && !check) writeFileSync(file, texts[name])
    process.stdout.write(`studio-snapshot: ${name} ${same ? 'is up to date' : check ? 'DIFFERS' : 'written'}\n`)
  }
  process.exit(check && differ ? 1 : 0)
}
