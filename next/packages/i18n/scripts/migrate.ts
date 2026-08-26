/**
 * One-time migration: legacy translation JSON → pure ICU MessageFormat.
 *
 * Conversions:
 *   {{param}}        → {param}          (Handlebars-style params)
 *   {param}          → unchanged        (already valid ICU)
 *   {{#b}}…{{/b}}    → <b>…</b>         (block tags; consumers are HTML emails)
 *   '                → ''               (ICU treats a lone apostrophe as quote syntax)
 *
 * Every converted message is compile-checked with IntlMessageFormat; the
 * script fails loudly on anything that doesn't parse.
 *
 * Usage: bun run scripts/migrate.ts <srcDir> <destDir>
 */
import IntlMessageFormat from 'intl-messageformat'

const [srcDir, destDir] = process.argv.slice(2)
if (!srcDir || !destDir) {
  console.error('usage: bun run scripts/migrate.ts <srcDir> <destDir>')
  process.exit(1)
}

function convertMessage(message: string): string {
  let out = message

  // Block tags first (before param conversion mangles them).
  out = out.replace(
    /\{\{#([a-z]+)\}\}(.*?)\{\{\/\1\}\}/gs,
    (_, tag, inner) => `<${tag}>${inner}</${tag}>`,
  )

  // Handlebars params → ICU params.
  out = out.replace(/\{\{\{?([a-zA-Z][a-zA-Z0-9_.]*)\}?\}\}/g, '{$1}')

  // Repair source typos: `{{param}` (missing second close) → `{param}`.
  out = out.replace(/\{\{([a-zA-Z][a-zA-Z0-9_.]*)\}(?!\})/g, '{$1}')

  // Escape apostrophes for ICU (all legacy apostrophes are literal text).
  out = out.replace(/'/g, "''")

  // Stray `{` not starting a param (source typos, non-Latin scripts) → literal.
  // Must run AFTER apostrophe escaping so the inserted quotes survive intact.
  out = out.replace(/\{(?![a-zA-Z}])/g, "'{'")

  return out
}

const glob = new Bun.Glob('*.json')
let files = 0
let messages = 0
const failures: string[] = []

for await (const file of glob.scan(srcDir)) {
  const source = await Bun.file(`${srcDir}/${file}`).json()
  const converted: Record<string, string> = {}

  for (const [key, message] of Object.entries(source)) {
    if (typeof message !== 'string') {
      failures.push(`${file}:${key} — non-string value`)
      continue
    }
    const icu = convertMessage(message)
    try {
      new IntlMessageFormat(icu, 'en')
    } catch (error) {
      failures.push(
        `${file}:${key} — ICU parse failed: ${error instanceof Error ? error.message : error}`,
      )
      continue
    }
    converted[key] = icu
    messages++
  }

  await Bun.write(`${destDir}/${file}`, `${JSON.stringify(converted, null, '\t')}\n`)
  files++
}

console.log(`migrated ${messages} messages across ${files} files`)

if (failures.length > 0) {
  console.error(`\n${failures.length} failures:`)
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
