import { withMermaid } from 'vitepress-plugin-mermaid'

const GITHUB = 'https://github.com/cri-middleware/SSPlayerForReactNative'

// Only ever the published address. `base` below is '/' during local dev, and a
// social card must advertise where the page really lives.
const SITE_URL = 'https://cri-middleware.github.io/SSPlayerForReactNative'

// Close to SSPlayerForWeb's shelves, with two deliberate divergences.
//
// What that site calls "Customize" is "Going further" here, and its pages stay
// under /usage/. Nothing on that shelf customizes *the package* — this port
// exposes no custom shaders and no extension points, so the sibling's name would
// promise a surface that does not exist. It is the same audience as Usage, one
// step in.
//
// And ROADMAP is not in the nav, where the sibling puts it. Three of the four
// nav entries stay on the site and that one bounced to raw markdown on GitHub;
// more to the point, it is a contributor's document — vertex ceilings, packaging
// decisions, a thread-safety note — sitting at the same level as Usage. The
// reader's version of "what is missing" is /limitations. Individual pages still
// link ROADMAP where a specific caveat is tracked there, which is sourcing
// rather than navigation.
//
// English only for now; the Japanese locale goes under /ja/ and is a ROADMAP
// item, with the TypeDoc reference staying shared at /api/ because it is
// language neutral.
//
// Two things to know before adding /ja/. VitePress slugifies a heading through
// NFKD, which *decomposes* voiced kana — the id for `プリロード` is フ+U+309A…,
// not the precomposed string you typed, so a hand-written `#プリロード` link
// silently does not match. Give every linked Japanese heading an explicit ASCII
// id (`## プリロード {#preloading}`), ideally the same one its English page
// uses. And VitePress's dead-link check does not look at anchors at all, so
// nothing catches this at build time.
//
// The sidebar is a difficulty gradient rather than a table of contents. Reading
// top to bottom, the effort rises: install and copy a snippet, get one animation
// playing, then the things a real app needs, then the reference to look names up
// in, then what to do when it breaks and what this port cannot do at all.
export default withMermaid({
  title: 'SSPlayerForReactNative',
  description: 'SpriteStudio 7 player for React Native (Nitro Modules + React Native Skia)',
  lastUpdated: true,
  cleanUrls: true,
  lang: 'en',
  base: '/SSPlayerForReactNative/',


  head: [['meta', { property: 'og:site_name', content: 'SSPlayerForReactNative' }]],

  transformPageData(pageData) {
    const title = pageData.frontmatter.title ?? pageData.title ?? 'SSPlayerForReactNative'
    const description = pageData.frontmatter.description ?? pageData.description ?? ''
    pageData.frontmatter.head ??= []
    pageData.frontmatter.head.push(
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: `${SITE_URL}/${pageData.relativePath.replace(/\.md$/, '')}` }],
      ['meta', { property: 'og:locale', content: pageData.relativePath.startsWith('ja/') ? 'ja_JP' : 'en_US' }],
      ['meta', { name: 'twitter:card', content: 'summary' }],
      ['meta', { name: 'twitter:site', content: '@spritestudio' }]
    )
  },

  themeConfig: {
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: GITHUB },
      { icon: 'x', link: 'https://x.com/spritestudio' },
    ],
  },

  locales: {
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        outline: { level: [2, 3], label: 'On this page' },
        nav: [
          { text: 'Setup', link: '/setup/install' },
          { text: 'Usage', link: '/usage/basic' },
          { text: 'API', link: '/api-guide' },
        ],
        sidebar: [
          {
            text: 'Setup',
            items: [
              { text: 'Installation', link: '/setup/install' },
              { text: 'Quick Start', link: '/setup/quickstart' },
              { text: 'Preparing assets (.sspj → .ssab)', link: '/setup/assets' },
            ],
          },
          {
            text: 'Usage',
            items: [
              { text: 'Basic playback', link: '/usage/basic' },
              { text: 'Transport', link: '/usage/transport' },
              { text: 'Many animations: a scene', link: '/usage/scene' },
            ],
          },
          {
            text: 'Going further',
            items: [
              { text: 'Events & user data', link: '/usage/events' },
              { text: 'Part overrides & following', link: '/usage/parts' },
              { text: 'Textures & resources', link: '/usage/textures' },
              { text: 'Reanimated', link: '/usage/reanimated' },
            ],
          },
          {
            text: 'API Reference',
            items: [
              { text: 'Where to start', link: '/api-guide' },
              { text: 'Components at a glance', link: '/components' },
              { text: 'Generated reference', link: '/api/' },
            ],
          },
          {
            text: 'Troubleshooting & Limits',
            items: [
              { text: 'Troubleshooting', link: '/troubleshooting' },
              { text: 'Limitations & Scope', link: '/limitations' },
            ],
          },
          {
            text: 'Development',
            items: [
              { text: 'Working from a checkout', link: '/development/from-source' },
              { text: 'Working on this repository', link: `${GITHUB}/blob/main/AGENTS.md` },
            ],
          },
        ],
      },
    },
  },
})
