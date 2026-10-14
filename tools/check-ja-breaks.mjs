#!/usr/bin/env node
//
// Finds a line break between two Japanese characters in the Markdown this
// repository tracks. Markdown joins the lines of a paragraph with a newline,
// and Chrome renders that newline as a space — so a sentence wrapped between
// two Japanese characters shows a gap the source does not, on the site and on
// GitHub alike. Wrapping beside a Latin word or a code span is harmless, which
// is why only Japanese-to-Japanese counts.
//
// What it compares is what renders: link targets, emphasis and code markers
// are stripped first, so a line ending in `[リンク](…)` ends in `ク`. Code
// fences, front matter, tables, headings and HTML are skipped, and a line that
// opens a list item, a quote or a container starts a new block rather than
// continuing one.
//
// Plain Node, like check-web-barrel.mjs: nothing here is platform-specific, and
// it needs no install — only git, for the list of tracked files.
//
// Usage: node tools/check-ja-breaks.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Hiragana, katakana, CJK ideographs, and the full-width punctuation that
// joins them (、。「」（）！？ …) — every character a Japanese sentence wraps at.
const JA = /[　-〿぀-ゟ゠-ヿㇰ-ㇿ㐀-䶿一-鿿＀-￯]/

// A submodule's files are not listed, which is the point: the SDK's pages are
// the SDK's to fix.
const files = execFileSync('git', ['ls-files', '-z', '--', '*.md'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)

/** The line as it renders, near enough to read its first and last character. */
const visible = (line) =>
  line
    // A code span renders its content — `<SpriteStudioScene>` is not a tag.
    .replace(/`+([^`]+?)`+/g, (_, code) => code.replace(/[<>[\]*_~]/g, 'x'))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    // A link whose text was wrapped: its target sits at the start of the
    // next line, and its `[` at the end of this one.
    .replace(/^[^[]*?\]\([^)]*\)/, (m) => m.slice(0, m.indexOf(']')))
    .replace(/<[^>]*>/g, '')
    .replace(/[*_`~[\]]/g, '')
    .trim()

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/

/** A line that cannot continue the paragraph above it. */
const opensBlock = (line) =>
  LIST_ITEM.test(line) ||
  /^\s*(:::|#|\||<|\[[^\]]+\]:)/.test(line) || // container, heading, table, HTML, link definition
  /^\s*([-*_])(\s*\1){2,}\s*$/.test(line) // a rule

const hits = []
for (const file of files) {
  const lines = readFileSync(join(ROOT, file), 'utf8').split(/\r?\n/)
  let fence = null
  let inFrontMatter = lines[0] === '---'
  let inComment = false
  let previous = null // { text, number, depth } of the line a paragraph could continue

  lines.forEach((raw, index) => {
    const number = index + 1
    if (inFrontMatter) {
      if (index > 0 && raw === '---') inFrontMatter = false
      return
    }
    // A quote's lines continue one another only at the same depth.
    const markers = raw.match(/^\s*((?:>\s?)*)/)[1]
    const depth = (markers.match(/>/g) ?? []).length
    const line = raw.slice(raw.indexOf(markers) + markers.length)
    if (previous != null && previous.depth !== depth) previous = null
    const fenceMark = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence != null) {
      if (fenceMark != null && fenceMark[1][0] === fence[0] && fenceMark[1].length >= fence.length) fence = null
      return
    }
    if (fenceMark != null) {
      fence = fenceMark[1]
      previous = null
      return
    }
    if (inComment || /^\s*<!--/.test(line)) {
      inComment = !line.includes('-->')
      previous = null
      return
    }
    if (line.trim() === '' || opensBlock(line)) {
      // A list item's own first line can still be continued below it.
      previous = LIST_ITEM.test(line) ? { text: line.replace(LIST_ITEM, ''), number, depth } : null
      return
    }
    if (previous != null && !/( {2}|\\)$/.test(previous.text)) {
      const before = visible(previous.text)
      const after = visible(line)
      if (JA.test(before.at(-1) ?? '') && JA.test(after[0] ?? '')) {
        hits.push(`${file}:${previous.number}  …${before.slice(-12)} ⏎ ${after.slice(0, 12)}…`)
      }
    }
    previous = { text: line, number, depth }
  })
}

if (hits.length > 0) {
  console.error(`check-ja-breaks: ${hits.length} line break(s) between two Japanese characters\n`)
  for (const hit of hits) console.error(`  ${hit}`)
  console.error(
    '\n  Each renders as a space. Join the two lines, or wrap beside a Latin word or a code span instead.'
  )
  process.exit(1)
}
console.log(`check-ja-breaks: ok (${files.length} files)`)
