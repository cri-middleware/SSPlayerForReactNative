// Copies the documentation into the package as docs/, so what a user's tooling
// reads in node_modules is the documentation of the version installed — not the
// site's, which is built from the latest release and can be ahead. English only,
// as the Markdown source, with the layout kept. `build` and `prepack` run it.
//
// docs/README.md is scripts/docs-README.md: the folder's front door, standing in
// for the site's home page. build-release checks every page it links to.
//
// It writes the same pages to skills/react-native-spritestudio/ as an Agent
// Skill: the front door is its SKILL.md, under the frontmatter that names it.
// pnpm links skills/<name>/ of a direct dependency into the project's agent
// skill directories, and the npm skills CLI does the same, so a link that
// leaves the folder resolves against the agent's directory instead — the pages
// are copied rather than pointed at.
//
// The pages link each other by relative `.md` path, and the layout is kept, so
// those resolve here as they do in the repository. Only a link to a page left out
// is rewritten as it is copied: the home page becomes the front door, and anything
// else — the page on building from a checkout, a page under ja/ — becomes its URL
// on the site. The TypeDoc API pages are already linked by their URL on the site.
//
// Left out of the repository's docs/: index.md (the home page), ja/ (the site has
// it), api/ (TypeDoc's output from the comments src/ and lib/typescript/ carry),
// development/ (working on this repository), and everything that is not a page.
// Everything else is taken by rule, not by list, so a page added there ships
// without anyone remembering to add it here.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = 'https://cri-middleware.github.io/SSPlayerForReactNative/'
const SKILL = 'react-native-spritestudio'
const SKILL_DESCRIPTION =
  'Documentation of SpriteStudio Player for React Native, for the version installed. Use when ' +
  'writing, reviewing or debugging code that plays SpriteStudio animations (.ssab, converted from ' +
  '.sspj) in a React Native or Expo app with react-native-spritestudio.'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = resolve(here, '..')
const src = resolve(pkgDir, '..', '..', 'docs')

const SKIP_DIRS = new Set(['ja', 'api', 'development', 'node_modules', 'public', '.vitepress'])
const pages = readdirSync(src, { recursive: true })
  .map((rel) => rel.split(sep).join('/'))
  .filter((rel) => rel.endsWith('.md') && rel !== 'index.md' && !SKIP_DIRS.has(rel.split('/')[0]))
  .sort()
const have = new Set(pages)

// A relative link to a page (`../usage/textures.md#anchor`) as seen from <page>,
// in a folder whose front door is <front>.
function rewritePageLink(target, page, front) {
  const [path, anchor] = target.split(/(?=#)/)
  const hash = anchor ?? ''
  const file = posix.join(posix.dirname(page), path)
  if (have.has(file)) return target
  if (file === 'index.md') return posix.relative(posix.dirname(page), front) + hash
  return SITE + file.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '') + hash
}

function rewrite(text, page, front) {
  return text.replace(
    /\]\(([^)\s:#]*\.md(?:#[^)\s]*)?)\)/g,
    (_, target) => `](${rewritePageLink(target, page, front)})`,
  )
}

function copyPages(out, front, frontText) {
  rmSync(out, { recursive: true, force: true })
  for (const page of pages) {
    const to = join(out, page)
    mkdirSync(dirname(to), { recursive: true })
    writeFileSync(to, rewrite(readFileSync(join(src, page), 'utf8'), page, front))
  }
  writeFileSync(join(out, front), frontText)
  console.log(`copy-docs: ${pages.length} pages + ${front} -> ${relative(pkgDir, out)}/`)
}

const frontDoor = readFileSync(join(here, 'docs-README.md'), 'utf8')
copyPages(join(pkgDir, 'docs'), 'README.md', frontDoor)
copyPages(
  join(pkgDir, 'skills', SKILL),
  'SKILL.md',
  `---\nname: ${SKILL}\ndescription: ${JSON.stringify(SKILL_DESCRIPTION)}\n---\n\n${frontDoor}`,
)
