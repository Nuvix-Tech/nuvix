import { beforeAll, describe, expect, test } from 'bun:test'
import { createTranslator } from '../src'
import { TranslationLoader } from '../src/loader'
import { bestMatch, parseAcceptLanguage, resolveLocale } from '../src/resolve'

const FIXTURES = new URL('./fixtures/translations', import.meta.url).pathname

describe('TranslationLoader', () => {
  test('lists available locales', async () => {
    const loader = new TranslationLoader(FIXTURES)
    expect(await loader.availableLocales()).toEqual(['de', 'en'])
  })

  test('returns null for missing locale', async () => {
    const loader = new TranslationLoader(FIXTURES)
    expect(await loader.load('xx')).toBeNull()
  })

  test('caches repeated loads', async () => {
    const loader = new TranslationLoader(FIXTURES)
    const first = await loader.load('en')
    const second = await loader.load('en')
    expect(second).toBe(first)
  })
})

describe('Translator', () => {
  let t: Awaited<ReturnType<typeof createTranslator>>
  let de: Awaited<ReturnType<typeof createTranslator>>

  beforeAll(async () => {
    const loader = new TranslationLoader(FIXTURES)
    t = await createTranslator({ loader, locale: 'en' })
    de = await createTranslator({ loader, locale: 'de' })
  })

  test('formats simple messages and params', () => {
    expect(t.format('hello')).toBe('Hello!')
    expect(t.format('greeting', { name: 'Ada' })).toBe('Hello Ada!')
  })

  test('handles ICU plural and select', () => {
    expect(t.format('photos', { count: 1 })).toBe('You have 1 photo.')
    expect(t.format('photos', { count: 5 })).toBe('You have 5 photos.')
    expect(t.format('replied', { gender: 'female' })).toBe('She replied.')
  })

  test('unescapes ICU apostrophes', () => {
    expect(t.format('apos')).toBe("Don't panic.")
  })

  test('falls back to fallback locale per-key', () => {
    // 'de' table only has 'hello'; 'greeting' comes from 'en'
    expect(de.format('hello')).toBe('Hallo!')
    expect(de.format('greeting', { name: 'Ada' })).toBe('Hello Ada!')
  })

  test('missing key everywhere returns the key itself', () => {
    expect(t.format('no.such.key')).toBe('no.such.key')
  })

  test('malformed ICU throws at format time', async () => {
    const loader = new TranslationLoader(new URL('./fixtures/broken', import.meta.url).pathname)
    const broken = await createTranslator({ loader, locale: 'en' })
    expect(() => broken.format('bad')).toThrow('failed to format')
  })
})

describe('locale resolution', () => {
  const available = ['en', 'de', 'fr', 'pt-pt']

  test('parses accept-language with q-values', () => {
    expect(parseAcceptLanguage('fr-CH, fr;q=0.9, en;q=0.8, *;q=0')).toEqual(['fr-ch', 'fr', 'en'])
  })

  test('bestMatch: exact > prefix > regional', () => {
    expect(bestMatch('fr', available)).toBe('fr')
    expect(bestMatch('fr-CH', available)).toBe('fr')
    expect(bestMatch('pt', available)).toBe('pt-pt')
    expect(bestMatch('zh', available)).toBeNull()
  })

  test('resolution chain: header > user > accept-language > default', () => {
    const base = { available }

    expect(resolveLocale({ ...base, headerLocale: 'de' })).toBe('de')
    expect(resolveLocale({ ...base, headerLocale: null, userLocale: 'fr' })).toBe('fr')
    expect(
      resolveLocale({
        ...base,
        headerLocale: null,
        userLocale: null,
        acceptLanguage: 'ja-JP,de;q=0.5',
      }),
    ).toBe('de')
    expect(resolveLocale({ ...base })).toBe('en')

    // header beats user pref
    expect(resolveLocale({ ...base, headerLocale: 'de', userLocale: 'fr' })).toBe('de')

    // unknown header falls through to next source
    expect(
      resolveLocale({
        ...base,
        headerLocale: 'xx',
        acceptLanguage: 'fr-CA',
      }),
    ).toBe('fr')
  })
})
