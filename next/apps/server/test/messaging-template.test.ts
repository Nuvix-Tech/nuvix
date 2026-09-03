import { describe, expect, test } from 'bun:test'
import { html, renderTemplate } from '../src/messaging/template'

describe('Bun-native Template Engine', () => {
  test('interpolates basic and nested variables', () => {
    const tmpl = 'Hello {{name}}, welcome to {{project.name}}!'
    const res = renderTemplate(tmpl, {
      name: 'Alice',
      project: { name: 'Nuvix Platform' },
    })
    expect(res).toBe('Hello Alice, welcome to Nuvix Platform!')
  })

  test('escapes HTML by default and preserves raw with triple braces', () => {
    const tmpl = 'Escaped: {{content}} | Raw: {{{content}}}'
    const res = renderTemplate(tmpl, { content: '<b>Alert & Win!</b>' })
    expect(res).toBe('Escaped: &lt;b&gt;Alert &amp; Win!&lt;/b&gt; | Raw: <b>Alert & Win!</b>')
  })

  test('renders conditionals with if and else', () => {
    const tmpl = 'Status: {{#if isPro}}PRO Member{{else}}Free Tier{{/if}}'
    expect(renderTemplate(tmpl, { isPro: true })).toBe('Status: PRO Member')
    expect(renderTemplate(tmpl, { isPro: false })).toBe('Status: Free Tier')
    expect(renderTemplate(tmpl, {})).toBe('Status: Free Tier')
  })

  test('renders loops with #each', () => {
    const tmpl = 'Items: {{#each items}}[{{this}}]{{/each}}'
    const res = renderTemplate(tmpl, { items: ['apple', 'banana', 'cherry'] })
    expect(res).toBe('Items: [apple][banana][cherry]')

    const objectLoop = 'Users: {{#each users}}{{name}} ({{role}}), {{/each}}'
    const resObj = renderTemplate(objectLoop, {
      users: [
        { name: 'Alice', role: 'admin' },
        { name: 'Bob', role: 'member' },
      ],
    })
    expect(resObj).toBe('Users: Alice (admin), Bob (member), ')
  })

  test('html tagged template literal escapes interpolation', () => {
    const name = '<script>bad()</script>'
    const count = 42
    const output = html`<div class="user">Hello ${name}, you have ${count} messages.</div>`
    expect(output).toBe(
      '<div class="user">Hello &lt;script&gt;bad()&lt;/script&gt;, you have 42 messages.</div>',
    )
  })
})
