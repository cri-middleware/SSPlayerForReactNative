import { withMermaid } from 'vitepress-plugin-mermaid'

const GITHUB = 'https://github.com/cri-middleware/SSPlayerForReactNative'

// Only ever the published address. `base` below is '/' during local dev, and a
// social card must advertise where the page really lives.
const SITE_URL = 'https://cri-middleware.github.io/SSPlayerForReactNative'

// Sections match SSPlayerForWeb's — Setup / Usage / API / Customize / limits /
// Development — so a reader moving between the players finds the same shelves.
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
// top to bottom, the effort rises: install and copy a snippet, then get one
// animation playing, then the reference, then the things a real app needs, then
// what to do when it breaks and what this port cannot do at all.
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
          { text: 'Customize', link: '/customize/events' },
          { text: 'ROADMAP', link: `${GITHUB}/blob/main/ROADMAP.md` },
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
            text: 'API Reference',
            items: [
              { text: 'Where to start', link: '/api-guide' },
              { text: 'Generated reference', link: '/api/' },
            ],
          },
          {
            text: 'Customize',
            items: [
              { text: 'Events & user data', link: '/customize/events' },
              { text: 'Part overrides & following', link: '/customize/parts' },
              { text: 'Textures & resources', link: '/customize/textures' },
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
