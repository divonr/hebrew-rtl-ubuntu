// Pure text logic: deciding each line's direction and laying out RTL rows.
//
// The terminal (VTE) reorders every row with the Unicode bidi algorithm on an
// LTR base, and Claude Code strips every bidi control character (RLM, RLE,
// isolates). So an RTL row is drawn by arrangement alone: compute how the row
// looks in a real RTL paragraph (`visual`, base RTL), then find the logical
// string that the terminal's own LTR pass turns into exactly that picture
// (`forTerminal`).

const HEBREW = /[א-תװ-ײיִ-ﭏ]/g
const LATIN = /[A-Za-zÀ-ɏ]/g
const FENCE = /^\s*(```|~~~)/
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

// ---------------------------------------------------------------- direction

/** RTL when Hebrew letters outnumber Latin ones; code, URLs and link targets don't vote. */
export const isRtl = (text: string): boolean => {
  const voting = text
    .replace(/`[^`]*`/g, '')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, '')
  const hebrew = voting.match(HEBREW)?.length ?? 0
  const latin = voting.match(LATIN)?.length ?? 0

  return hebrew > latin
}

export const hasHebrew = (text: string): boolean => /[א-ת]/.test(text)

// ---------------------------------------------------------------- the bidi algorithm

type BidiClass = 'L' | 'R' | 'EN' | 'ES' | 'ET' | 'CS' | 'WS' | 'ON'

/** A character with what follows it on the same cell (niqqud, accents). */
export type Glyph = { ch: string; style: number }

const R_CHAR = /[־׀׃׆א-תׯ-״יִײַ-ﭏ؀-ۿ]/u
const MARK = /\p{M}/u
const MIRROR: Record<string, string> = {
  '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<',
  '«': '»', '»': '«', '‹': '›', '›': '‹',
}

const classOf = (ch: string): BidiClass => {
  const base = [...ch][0] ?? ' '
  if (R_CHAR.test(base)) return 'R'
  if (/[0-9]/.test(base)) return 'EN'
  if (/[+\-]/.test(base)) return 'ES'
  if (/[#$%°¢£¤¥₪€‰]/.test(base)) return 'ET'
  if (/[,.:/ ]/.test(base)) return 'CS'
  if (/\s/.test(base)) return 'WS'
  if (/[\p{L}\p{M}]/u.test(base)) return 'L'

  return 'ON'
}

/** Splits text into cells: a base character with its combining marks. */
export const clusters = (text: string): string[] => {
  const out: string[] = []
  for (const ch of text) {
    if (MARK.test(ch) && out.length > 0) out[out.length - 1] += ch
    else out.push(ch)
  }

  return out
}

/** Embedding levels of one paragraph (rules W1–W7, N1–N2, I1–I2, L1). */
const levels = (types: BidiClass[], base: 0 | 1): number[] => {
  const t = [...types]
  const n = t.length
  const baseDir: BidiClass = base ? 'R' : 'L'
  const strongBefore = (k: number): BidiClass => {
    for (let j = k - 1; j >= 0; j--) if (t[j] === 'L' || t[j] === 'R') return t[j]!
    return baseDir
  }
  // W4: a single separator between two numbers joins them.
  for (let k = 1; k < n - 1; k++) {
    if (t[k - 1] === 'EN' && t[k + 1] === 'EN' && (t[k] === 'ES' || t[k] === 'CS')) t[k] = 'EN'
  }
  // W5: currency and percent signs next to a number belong to it.
  for (let k = 0; k < n; k++) {
    if (t[k] !== 'ET') continue
    let end = k
    while (end < n && t[end] === 'ET') end++
    if (t[k - 1] === 'EN' || t[end] === 'EN') for (let j = k; j < end; j++) t[j] = 'EN'
    k = end - 1
  }
  // W6: what's left of the separators is neutral.
  for (let k = 0; k < n; k++) if (t[k] === 'ES' || t[k] === 'ET' || t[k] === 'CS') t[k] = 'ON'
  // W7: a number after Latin text reads as Latin.
  for (let k = 0; k < n; k++) if (t[k] === 'EN' && strongBefore(k) === 'L') t[k] = 'L'
  // N1, N2: neutrals take their neighbours' direction, or the paragraph's.
  const dir = (c: BidiClass | undefined): 'L' | 'R' => (c === 'L' ? 'L' : 'R')
  for (let k = 0; k < n; k++) {
    if (t[k] !== 'ON' && t[k] !== 'WS') continue
    let end = k
    while (end < n && (t[end] === 'ON' || t[end] === 'WS')) end++
    const before = k === 0 ? baseDir : dir(t[k - 1])
    const after = end === n ? baseDir : dir(t[end])
    const resolved = before === after ? before : baseDir
    for (let j = k; j < end; j++) t[j] = resolved
    k = end - 1
  }
  // I1, I2.
  const out = t.map(c =>
    base === 0 ? (c === 'R' ? 1 : c === 'EN' ? 2 : 0) : c === 'L' || c === 'EN' ? 2 : 1,
  )
  // L1: trailing whitespace sits at the paragraph's level.
  for (let k = n - 1; k >= 0 && types[k] === 'WS'; k--) out[k] = base

  return out
}

/** How a row of glyphs is drawn left to right in a paragraph of direction `base`. */
export const visual = (row: Glyph[], base: 0 | 1): Glyph[] => {
  const lv = levels(row.map(g => classOf(g.ch)), base)
  const order = row.map((_, k) => k)
  const top = Math.max(0, ...lv)
  const lowestOdd = Math.min(...lv.filter(l => l % 2 === 1), top + 1)
  for (let level = top; level >= lowestOdd; level--) {
    for (let k = 0; k < order.length; k++) {
      if ((lv[order[k]!] ?? 0) < level) continue
      let end = k
      while (end < order.length && (lv[order[end]!] ?? 0) >= level) end++
      const run = order.slice(k, end).reverse()
      order.splice(k, run.length, ...run)
      k = end
    }
  }

  return order.map(k => {
    const g = row[k]!
    const mirrored = (lv[k] ?? 0) % 2 === 1 ? MIRROR[g.ch] : undefined
    return mirrored ? { ...g, ch: mirrored } : g
  })
}

const NUMBER = /[#$%°¢£¤¥₪€‰]*[0-9]+(?:[.,:/][0-9]+)*[#$%°¢£¤¥₪€‰]*/g

/**
 * The logical row the terminal's LTR bidi pass draws as `picture`: each span
 * of the picture that runs from a Hebrew letter to a Hebrew letter with no
 * Latin letter inside is handed over reversed (numbers inside kept as they
 * read, brackets swapped), since the terminal will reverse it back.
 */
export const forTerminal = (picture: Glyph[]): Glyph[] => {
  const types = picture.map(g => classOf(g.ch))
  const out = [...picture]
  for (let k = 0; k < out.length; k++) {
    if (types[k] !== 'R') continue
    let end = k
    for (let j = k + 1; j < out.length && types[j] !== 'L'; j++) if (types[j] === 'R') end = j
    const span = picture.slice(k, end + 1).reverse()
    const text = span.map(g => (g.ch.length === 1 ? g.ch : 'x')).join('')
    for (const m of text.matchAll(NUMBER)) {
      const at = m.index ?? 0
      const number = span.slice(at, at + m[0].length).reverse()
      span.splice(at, number.length, ...number)
    }
    out.splice(k, span.length, ...span.map(g => ({ ...g, ch: MIRROR[g.ch] ?? g.ch })))
    k = end
  }

  return out
}

/** One RTL row, ready for the terminal. */
export const rtlRow = (row: Glyph[]): Glyph[] => forTerminal(visual(row, 1))

// ---------------------------------------------------------------- inline markdown

export const BOLD = 1
export const ITALIC = 2
export const CODE = 4
export const LINK = 8
export const STRIKE = 16

/** Inline markdown as styled glyphs: bold, italic, code, links, strikethrough. */
export const inline = (text: string): Glyph[] => {
  const out: Glyph[] = []
  let style = 0
  const chars = [...text]
  for (let k = 0; k < chars.length; k++) {
    const ch = chars[k]!
    const next = chars[k + 1]
    if (ch === '\\' && next !== undefined && /[\\`*_[\]()#+\-.!~|]/.test(next)) {
      out.push({ ch: next, style })
      k++
      continue
    }
    if (ch === '`') {
      const close = chars.indexOf('`', k + 1)
      if (close > k) {
        for (const c of chars.slice(k + 1, close)) out.push({ ch: c, style: style | CODE })
        k = close
        continue
      }
    }
    if ((ch === '*' || ch === '_') && next === ch) {
      style ^= BOLD
      k++
      continue
    }
    if (ch === '~' && next === '~') {
      style ^= STRIKE
      k++
      continue
    }
    if (ch === '*' && next !== ' ') {
      if ((style & ITALIC) || chars.indexOf('*', k + 1) > k) {
        style ^= ITALIC
        continue
      }
    }
    if (ch === '[') {
      const rest = chars.slice(k).join('')
      const link = rest.match(/^\[([^\]]*)\]\(([^)]*)\)/)
      if (link) {
        for (const c of link[1]!) out.push({ ch: c, style: style | LINK })
        k += [...link[0]].length - 1
        continue
      }
    }
    out.push({ ch, style })
  }

  // Marks join the cell before them.
  const merged: Glyph[] = []
  for (const g of out) {
    const last = merged[merged.length - 1]
    if (MARK.test(g.ch) && last) last.ch += g.ch
    else merged.push({ ...g })
  }

  return merged
}

export const plainGlyphs = (text: string): Glyph[] => clusters(text).map(ch => ({ ch, style: 0 }))

// ---------------------------------------------------------------- layout

export type Segment =
  | { kind: 'ltr'; text: string; gap: boolean }
  | { kind: 'rtl'; lines: string[]; gap: boolean }
  | { kind: 'table'; rtl: boolean; source: string; rows: string[][]; gap: boolean }

const parseRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map(cell => cell.trim().replace(/\\\|/g, '|'))

/**
 * Splits text into runs. Every line (one Enter) is its own paragraph and
 * votes alone; a code fence is always LTR; a table votes as a whole. `gap`
 * marks a run that blank lines separate from the one before.
 */
export const segment = (text: string): Segment[] => {
  const lines = text.split('\n')
  const at = (k: number): string => lines[k] ?? ''
  const out: Segment[] = []
  let gap = false

  const add = (kind: 'ltr' | 'rtl', chunk: string) => {
    const last = out[out.length - 1]
    if (last?.kind === 'rtl' && kind === 'rtl') {
      if (gap) last.lines.push('')
      last.lines.push(chunk)
    } else if (last?.kind === 'ltr' && kind === 'ltr') {
      last.text += (gap ? '\n\n' : '\n') + chunk
    } else if (kind === 'rtl') {
      out.push({ kind, lines: [chunk], gap: gap && out.length > 0 })
    } else {
      out.push({ kind, text: chunk, gap: gap && out.length > 0 })
    }
    gap = false
  }

  let i = 0
  while (i < lines.length) {
    const line = at(i)
    if (FENCE.test(line)) {
      const fence = line.trim().slice(0, 3)
      const block = [line]
      i++
      while (i < lines.length) {
        block.push(at(i))
        i++
        if (at(i - 1).trim().startsWith(fence)) break
      }
      add('ltr', block.join('\n'))
      continue
    }
    if (line.trim() === '') {
      gap = true
      i++
      continue
    }
    if (line.trim().startsWith('|') && TABLE_RULE.test(at(i + 1))) {
      const block: string[] = []
      while (i < lines.length && at(i).trim().startsWith('|')) {
        block.push(at(i))
        i++
      }
      const rows = block.filter((_, k) => k !== 1).map(parseRow)
      out.push({
        kind: 'table',
        rtl: isRtl(rows.flat().join(' ')),
        source: block.join('\n'),
        rows,
        gap: gap && out.length > 0,
      })
      gap = false
      continue
    }
    add(isRtl(line) ? 'rtl' : 'ltr', line)
    i++
  }

  return out
}

/** Greedy word wrap of glyphs to `width` cells; spaces at a break are dropped. */
export const wrap = (glyphs: Glyph[], width: number): Glyph[][] => {
  const words: Glyph[][] = []
  let word: Glyph[] = []
  for (const g of glyphs) {
    if (g.ch === ' ') {
      if (word.length) words.push(word)
      word = []
    } else word.push(g)
  }
  if (word.length) words.push(word)

  const rows: Glyph[][] = []
  let row: Glyph[] = []
  for (const w of words) {
    if (row.length === 0) row = [...w]
    else if (row.length + 1 + w.length <= width) {
      const space = { ch: ' ', style: (row[row.length - 1]!.style & w[0]!.style) }
      row.push(space, ...w)
    } else {
      rows.push(row)
      row = [...w]
    }
  }
  if (row.length || rows.length === 0) rows.push(row)

  return rows
}

export type RtlRow = { glyphs: Glyph[]; indent: number }

/**
 * One source line of RTL text as the rows it draws, each ready for the
 * terminal: markdown block syntax (lists, headings, quotes) turned into
 * glyphs that sit on the right, indentation moved to the right.
 * `markdown` false keeps the line as typed.
 */
export const rtlRows = (line: string, width: number, markdown = true): RtlRow[] => {
  if (line.trim() === '') return [{ glyphs: [], indent: 0 }]
  const indent = line.match(/^\s*/)![0].replace(/\t/g, '  ').length
  let body = line.trim()
  let glyphs: Glyph[]
  if (markdown) {
    let style = 0
    const heading = body.match(/^#{1,6}\s+(.*?)\s*#*$/)
    if (heading) {
      body = heading[1]!
      style = BOLD
    }
    body = body
      .replace(/^>\s?/, '│ ')
      .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, (_, box?: string) =>
        box ? (box.trim() === '[ ]' ? '☐ ' : '☑ ') : '• ',
      )
      // A list number would be pulled to the wrong side by the terminal; a
      // circled number is a symbol, and stays where it's put.
      .replace(/^(\d+)[.)]\s+/, (m, d: string) => {
        const n = Number(d)
        return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) + ' ' : m
      })
    glyphs = inline(body).map(g => ({ ...g, style: g.style | style }))
  } else {
    glyphs = plainGlyphs(body)
  }

  return wrap(glyphs, Math.max(10, width - indent)).map(row => ({ glyphs: rtlRow(row), indent }))
}

/** Consecutive glyphs of one style, as the spans a row draws. */
export const spans = (glyphs: Glyph[]): { text: string; style: number }[] => {
  const out: { text: string; style: number }[] = []
  for (const g of glyphs) {
    const last = out[out.length - 1]
    if (last && last.style === g.style) last.text += g.ch
    else out.push({ text: g.ch, style: g.style })
  }

  return out
}

/**
 * An RTL table as rows ready for the terminal: the picture is built as it
 * should look (first column on the right, cells right-aligned, each cell's
 * text in RTL order), then arranged for the terminal like any RTL row.
 */
export const rtlTable = (rows: string[][]): Glyph[][] => {
  const columns = Math.max(...rows.map(r => r.length))
  const grid = rows.map(r =>
    Array.from({ length: columns }, (_, c) => visual(inline(r[c] ?? ''), 1)),
  )
  const widths = Array.from({ length: columns }, (_, c) =>
    Math.max(1, ...grid.map(r => r[c]?.length ?? 0)),
  )
  const g = (text: string, style = 0): Glyph[] => plainGlyphs(text).map(x => ({ ...x, style }))
  const mirrored = [...widths].reverse()
  const rule = (left: string, mid: string, right: string) =>
    g(left + mirrored.map(w => '─'.repeat(w + 2)).join(mid) + right)
  const row = (cells: Glyph[][], style: number): Glyph[] => {
    const picture: Glyph[] = g('│')
    cells
      .map((cell, c) => ({ cell, width: widths[c] ?? 0 }))
      .reverse()
      .forEach(({ cell, width }) => {
        picture.push(...g(' '.repeat(width - cell.length + 1)))
        picture.push(...cell.map(x => ({ ...x, style: x.style | style })))
        picture.push(...g(' │'))
      })
    return forTerminal(picture)
  }
  const [header, ...body] = grid

  return [
    rule('┌', '┬', '┐'),
    row(header ?? [], BOLD),
    rule('├', '┼', '┤'),
    ...body.map(r => row(r, 0)),
    rule('└', '┴', '┘'),
  ]
}
