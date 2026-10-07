# hebrew-rtl-ubuntu

A Claude Code mod that draws Hebrew right-to-left in the terminal.

- Each paragraph (every Enter) is Hebrew or English by **majority of letters**, not by its first character.
- Hebrew paragraphs are drawn in true RTL order and right-aligned: punctuation lands on the left, English words inside keep their place, brackets mirror, lists and headings sit on the right.
- English paragraphs, code blocks and English tables are left exactly as Claude Code draws them.
- Tables whose letters are mostly Hebrew are drawn mirrored, first column on the right.
- Applies to Claude's replies and to your own messages. `/rtl` toggles it.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install hebrew-rtl-ubuntu --marketplace divonr/hebrew-rtl-ubuntu
```

Answer `y` to add the marketplace, then press Enter for the user scope. It's active right away.

## Tested on

**Ubuntu 24.04, GNOME Terminal (VTE 0.76).** That is the only setup it has been tested on.

Claude Code strips bidi control characters, so the mod can't simply mark a line as RTL. Instead it arranges each Hebrew line's characters so that the terminal's own bidi reordering produces the RTL picture. In principle it should work in any terminal that already draws Hebrew letters in the right order on its own (without reversing words), but that hasn't been verified anywhere else. In a terminal that doesn't reorder Hebrew at all, Hebrew letters will appear reversed. If you try it elsewhere, reports are welcome in the issues.

## Limits

- The box you type into isn't affected; your message switches to RTL once sent.
- A number at the very start of a Hebrew line (`3 תפוחים`) lands on the left.
- Numbered lists in Hebrew show as ① ② ③.

## License

MIT
