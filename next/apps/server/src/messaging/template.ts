/**
 * Zero-dependency, Bun-native template engine for messaging.
 *
 * Provides:
 * 1. Mustache/Handlebars syntax compatibility ({{var}}, {{#if}}, {{#each}}, {{{raw}}})
 * 2. Tagged template literal helper (`html`...``) for type-safe native HTML templating
 * 3. HTML-safe auto-escaping
 */

function escapeHtml(value: unknown): string {
  const str = value !== undefined && value !== null ? String(value) : ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function resolvePath(path: string, context: Record<string, unknown>): unknown {
  const parts = path.trim().split('.')
  let current: unknown = context
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function renderTemplate(template: string, data: Record<string, unknown> = {}): string {
  if (!template) return ''

  // 1. Conditionals: {{#if path}}...{{else}}...{{/if}}
  let rendered = template.replace(
    /\{\{#if\s+([\w.]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
    (_, key, thenBranch, elseBranch = '') => {
      const val = resolvePath(key, data)
      return val ? renderTemplate(thenBranch, data) : renderTemplate(elseBranch, data)
    },
  )

  // 2. Loops: {{#each path}}...{{/each}}
  rendered = rendered.replace(
    /\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_, key, body) => {
      const list = resolvePath(key, data)
      if (!Array.isArray(list)) return ''
      return list
        .map((item) => {
          if (typeof item === 'object' && item !== null) {
            return renderTemplate(body, { ...data, ...item })
          }
          return renderTemplate(body.replace(/\{\{this\}\}/g, String(item)), data)
        })
        .join('')
    },
  )

  // 3. Raw / Unescaped Interpolation: {{{var}}}
  rendered = rendered.replace(/\{\{\{([\w.]+)\}\}\}/g, (_, key) => {
    const val = resolvePath(key, data)
    return val !== undefined && val !== null ? String(val) : ''
  })

  // 4. Escaped Interpolation: {{var}}
  rendered = rendered.replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
    const val = resolvePath(key, data)
    return val !== undefined && val !== null ? escapeHtml(val) : ''
  })

  return rendered
}

/**
 * Tagged template literal for constructing safe HTML strings in Bun.
 * Automatically escapes interpolated string/number values.
 */
export function html(strings: TemplateStringsArray, ...values: readonly unknown[]): string {
  let result = ''
  for (let i = 0; i < strings.length; i++) {
    result += strings[i]
    if (i < values.length) {
      const val = values[i]
      result += escapeHtml(val)
    }
  }
  return result
}
