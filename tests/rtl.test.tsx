import { describe, expect, test } from 'claude-code/testing'

import {
  BOLD,
  forTerminal,
  inline,
  isRtl,
  plainGlyphs,
  rtlRows,
  rtlTable,
  segment,
  visual,
  wrap,
} from '../hooks/bidi'
import type { Glyph } from '../hooks/bidi'

const text = (glyphs: Glyph[]) => glyphs.map(g => g.ch).join('')

describe('direction by majority', () => {
  test('Hebrew paragraph that opens with an English word is RTL', async () => {
    expect(isRtl('Now ירדתי שתי שורות ברצף, מה שאמור בוודאות לייצר פסקה חדשה')).toBe(true)
  })
  test('English paragraph that opens with a Hebrew word is LTR', async () => {
    expect(isRtl('שלום, this paragraph is mostly written in English words')).toBe(false)
  })
  test('code spans and URLs do not vote', async () => {
    expect(isRtl('הרץ את `npm install --save-dev typescript` עכשיו')).toBe(true)
  })
})

describe('segments', () => {
  test('one Enter starts a new paragraph that votes alone', async () => {
    const segs = segment('הנה פסקה בעברית לניסיון.\nOne line-breaking and now switching to English.')
    expect(segs.map(s => s.kind)).toEqual(['rtl', 'ltr'])
    expect(segs[1]?.gap).toBe(false)
  })
  test('blank lines become gaps; code fences stay LTR', async () => {
    const segs = segment('שלום, זו פסקה.\n\nThis one is English.\n\n```\nקוד עם עברית\n```\n\nועוד פסקה.')
    expect(segs.map(s => [s.kind, s.gap])).toEqual([
      ['rtl', false],
      ['ltr', true],
      ['rtl', true],
    ])
  })
  test('a table votes as a whole', async () => {
    const he = segment('| שם | גיל |\n|---|---|\n| דנה | 30 |\n| Bob | 41 |')
    expect(he).toMatchObject([{ kind: 'table', rtl: true }])
    const en = segment('| Name | Notes |\n|---|---|\n| דנה | likes coffee |')
    expect(en).toMatchObject([{ kind: 'table', rtl: false }])
  })
})

describe('the RTL picture', () => {
  test('a real RTL paragraph: punctuation left, English in place, brackets mirrored', async () => {
    const row = plainGlyphs('זה test של RTL, עם (סוגריים) ו-3.14!')
    expect(text(visual(row, 1))).toBe('!3.14-ו (םיירגוס) םע ,RTL לש test הז')
  })

  // These lines were checked against a real VTE 0.76 render: the terminal's
  // own LTR pass over `forTerminal`'s output draws exactly the RTL picture.
  const lines = [
    'הנה פסקה בעברית לניסיון.',
    'Now ירדתי שתי שורות ברצף, מה שאמור לייצר פסקה חדשה.',
    'זה test של RTL, עם (סוגריים) ומספר 3.14 ו-50% הנחה!',
    'ב-2024 שיניתי 2 קבצים ב-Claude Code.',
    'פרק 3',
    'קובץ config.json עם 12 שדות: name, version.',
    '"ציטוט" בתחילת שורה, ושאלה בסוף?',
    'שלום עולםָ עם ניקוד',
  ]
  for (const line of lines) {
    test(`the terminal draws the RTL picture: ${line}`, async () => {
      const picture = visual(inline(line), 1)
      expect(text(visual(forTerminal(picture), 0))).toBe(text(picture))
    })
  }
})

describe('rows', () => {
  test('wrap keeps rows within width', async () => {
    const rows = wrap(inline('אחת **שתיים שלוש** ארבע חמש'), 12)
    expect(rows.every(r => r.length <= 12)).toBe(true)
  })
  test('markdown becomes styles, not markers', async () => {
    const glyphs = inline('שלום **עולם** `code`')
    expect(text(glyphs)).toBe('שלום עולם code')
    expect(glyphs.filter(g => g.style & BOLD).map(g => g.ch).join('')).toBe('עולם')
  })
  test('list bullet and number sit on the right', async () => {
    const [bullet] = rtlRows('  - פריט.', 40)
    expect(bullet?.indent).toBe(2)
    expect(text(visual(bullet!.glyphs, 0))).toBe('.טירפ •')
    const [numbered] = rtlRows('2. פריט', 40)
    expect(text(visual(numbered!.glyphs, 0))).toBe('טירפ ②')
  })
  test('RTL table: first column on the right, rows equal width', async () => {
    const rows = rtlTable([['שם', 'גיל'], ['דנה', '30']]).map(r => text(visual(r, 0)))
    expect(new Set(rows.map(r => r.length)).size).toBe(1)
    expect(rows[1]).toBe('│ ליג │  םש │')
    expect(rows[3]).toBe('│  30 │ הנד │')
  })
})

const reply = (body: string) => ({
  plugin: 'hebrew-rtl-ubuntu',
  surface: 'terminal' as const,
  component: 'AssistantMessage' as const,
  props: { text: body, isFirstOfReply: true },
  viewport: { columns: 80, rows: 24 },
})

test('assistant reply in Hebrew draws right-aligned rows, English through Markdown', async $ => {
  const ui = await $.ui.mount(reply('שלום! זו תשובה בעברית.\n\nAnd this is English.'))
  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes.some(b => b.props.justifyContent === 'flex-end')).toBe(true)
  const md = await ui.findAll({ type: 'Markdown' })
  expect(md.map(m => m.text)).toEqual(['And this is English.'])
})

test('user prompt draws as plain Text on the message background', async $ => {
  const ui = await $.ui.mount({
    plugin: 'hebrew-rtl-ubuntu',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: 'שלום **עולם**\nHello there', origin: { kind: 'composer' }, isExpanded: true },
    viewport: { columns: 80, rows: 24 },
  })
  expect(await ui.findAll({ type: 'Markdown' })).toHaveLength(0)
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain('Hello there')
  expect(texts.join('')).toContain('**')
  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes.some(b => b.props.backgroundColor === 'userMessageBackground')).toBe(true)
})

test('English-only reply is left to the engine', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount(reply('Only English here.'))
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
})
