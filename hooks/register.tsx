import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { BOLD, CODE, ITALIC, LINK, STRIKE, hasHebrew, rtlRows, rtlTable, segment, spans } from './bidi'
import type { Glyph } from './bidi'

const isEnabled = atom({ plugin: 'hebrew-rtl-ubuntu', key: 'isEnabled' } as const, true)

const GUTTER = 2

function wants(surface: string, text: string): boolean {
  return (
    surface === 'terminal' &&
    hasHebrew(text) &&
    segment(text).some(s => s.kind === 'rtl' || (s.kind === 'table' && s.rtl))
  )
}

// One terminal row of glyphs already arranged for the terminal's bidi pass,
// drawn as styled spans side by side.
function glyphRow(Box: any, Text: any, glyphs: Glyph[]) {
  return (
    <Box flexDirection="row" flexShrink={0}>
      {spans(glyphs).map(span => (
        <Text
          bold={(span.style & BOLD) !== 0}
          italic={(span.style & ITALIC) !== 0}
          underline={(span.style & LINK) !== 0}
          strikethrough={(span.style & STRIKE) !== 0}
          color={span.style & CODE ? 'permission' : undefined}
        >
          {span.text}
        </Text>
      ))}
    </Box>
  )
}

// Draws a message body. `markdown` (a reply) draws LTR runs and LTR tables
// through the engine's own Markdown; a prompt draws its text as typed.
// RTL rows are right-aligned one per line; an RTL table is box-drawn.
function body(Box: any, Text: any, Markdown: any, text: string, width: number, markdown: boolean) {
  const line = (text: string) => (markdown ? <Markdown text={text} /> : <Text>{text}</Text>)

  return (
    <Box flexDirection="column" width={width}>
      {segment(text).map(s => (
        <Box flexDirection="column" marginTop={s.gap ? 1 : 0}>
          {s.kind === 'rtl' &&
            s.lines.flatMap(source =>
              rtlRows(source, width, markdown).map(row => (
                <Box justifyContent="flex-end" marginRight={row.indent} minHeight={1}>
                  {row.glyphs.length > 0 && glyphRow(Box, Text, row.glyphs)}
                </Box>
              )),
            )}
          {s.kind === 'ltr' && line(s.text)}
          {s.kind === 'table' &&
            (s.rtl ? (
              <Box flexDirection="column" alignItems="flex-end">
                {rtlTable(s.rows).map(row => glyphRow(Box, Text, row))}
              </Box>
            ) : (
              line(s.source)
            ))}
        </Box>
      ))}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rtl',
      description: 'Toggle right-to-left layout for Hebrew paragraphs',
    })

    return next(e)
  })

  on('command.run', { command: 'rtl' }, async $ => {
    const now = await update($, isEnabled, was => !was)

    return { text: now ? 'RTL on: Hebrew paragraphs are right-aligned.' : 'RTL off.' }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary || !wants(e.surface, e.props.text) || !(await read($, isEnabled))) {
      return next(e)
    }
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const width = (e.viewport?.columns ?? 80) - GUTTER - 1

    return (
      <Box flexDirection="row">
        <Box width={GUTTER} flexShrink={0}>
          <Text>{e.props.isFirstOfReply ? '⏺' : ' '}</Text>
        </Box>
        {body(Box, Text, Markdown, e.props.text, width, true)}
      </Box>
    )
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const isPrompt = e.props.origin.kind === 'composer' || e.props.origin.kind === 'bridge'
    if (!isPrompt || !wants(e.surface, e.props.text) || !(await read($, isEnabled))) {
      return next(e)
    }
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const width = (e.viewport?.columns ?? 80) - GUTTER - 1

    return (
      <Box flexDirection="row" marginTop={1} backgroundColor="userMessageBackground">
        <Box width={GUTTER} flexShrink={0}>
          <Text dimColor>❯</Text>
        </Box>
        {body(Box, Text, Markdown, e.props.text, width, false)}
      </Box>
    )
  })
}
