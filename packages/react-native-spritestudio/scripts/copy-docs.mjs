// Copies the documentation into the package as docs/, so what a user's tooling
// reads in node_modules is the documentation of the version installed — not the
// site's, which is built from the latest release and can be ahead. English only,
// as the Markdown source, with the layout kept. `build` and `prepack` run it.
//
// docs/README.md is scripts/docs-README.md: the folder's front door, standing in
// for the site's home page. build-release checks every page it links to.
//
// The pages are VitePress's, which links between them by site path
// (`/usage/textures`). Those are rewritten as they are copied, so they resolve as
// files: a page the folder has becomes a relative `.md` link, `/` becomes the
// front door, and anything else — the TypeDoc API pages, the page on building
// from a checkout — becomes its URL on the site, as does an HTML `href`.
//
// Left out of the repository's docs/: index.md (the home page), ja/ (the site has
// it), api/ (TypeDoc's output from the comments src/ and lib/typescript/ carry),
// development/ (working on this repository), and everything that is not a page.
// Everything else is taken by rule, not by list, so a page added there ships
// without anyone remembering to add it here.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = 'https://cri-middleware.github.io/SSPlayerForReactNative/'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = resolve(here, '..')
const src = resolve(pkgDir, '..', '..', 'docs')
const out = join(pkgDir, 'docs')

const SKIP_DIRS = new Set(['ja', 'api', 'development', 'node_modules', 'public', '.vitepress'])
const pages = readdirSync(src, { recursive: true })
  .map((rel) => rel.split(sep).join('/'))
  .filter((rel) => rel.endsWith('.md') && rel !== 'index.md' && !SKIP_DIRS.has(rel.split('/')[0]))
  .sort()
const have = new Set(pages)

// A site path (`/usage/textures#anchor`) as seen from <page>.
function rewriteSitePath(target, page) {
  const [path, anchor] = target.split(/(?=#)/)
  const hash = anchor ?? ''
  if (path === '/') return posix.relative(posix.dirname(page), 'README.md') + hash
  const bare = path.slice(1).replace(/\.md$/, '').replace(/\/$/, '')
  for (const file of [`${bare}.md`, `${bare}/index.md`]) {
    if (have.has(file)) return posix.relative(posix.dirname(page), file) + hash
  }
  return SITE + path.slice(1).replace(/\.md$/, '') + hash
}

function rewrite(text, page) {
  // The URL the site serves this page at (cleanUrls), for HTML's relative hrefs.
  const pageUrl = SITE + page.replace(/\.md$/, '')
  return text
    .replace(/\]\((\/[^)\s]*)\)/g, (_, target) => `](${rewriteSitePath(target, page)})`)
    .replace(/href="([^"#:]*)"/g, (whole, target) => {
      if (target === '') return whole
      return `href="${target.startsWith('/') ? SITE + target.slice(1) : new URL(target, pageUrl).href}"`
    })
}

rmSync(out, { recursive: true, force: true })
for (const page of pages) {
  const to = join(out, page)
  mkdirSync(dirname(to), { recursive: true })
  writeFileSync(to, rewrite(readFileSync(join(src, page), 'utf8'), page))
}
writeFileSync(join(out, 'README.md'), readFileSync(join(here, 'docs-README.md'), 'utf8'))

console.log(`copy-docs: ${pages.length} pages + README.md -> docs/`)
