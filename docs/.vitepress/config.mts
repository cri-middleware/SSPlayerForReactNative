import { withMermaid } from 'vitepress-plugin-mermaid'

const GITHUB = 'https://github.com/cri-middleware/SSPlayerForReactNative'

// Only ever the published address. `base` below is a path, not an origin, so it
// cannot build an absolute og:url on its own.
const SITE_URL = 'https://cri-middleware.github.io/SSPlayerForReactNative'

// Close to SSPlayerForWeb's shelves, with two deliberate divergences.
//
// What that site calls "Customize" is "Going further" here, and its pages stay
// under /usage/. Nothing on that shelf customizes *the package* — this port
// exposes no custom shaders and no extension points, so the sibling's name would
// promise a surface that does not exist. It is the same audience as Usage, one
// step in.
//
// And ROADMAP is not in the nav, where the sibling puts it. Every entry here
// stays on the site; the sibling's fifth bounced to raw markdown on GitHub;
// more to the point, it is a contributor's document — vertex ceilings, packaging
// decisions, a thread-safety note — sitting at the same level as Usage. The
// reader's version of "what is missing" is /limitations. Individual pages still
// link ROADMAP where a specific caveat is tracked there, which is sourcing
// rather than navigation.
//
// English at the root, Japanese under /ja/, and the TypeDoc reference shared by
// both at /api/ because it is language neutral.
//
// **Every linked Japanese heading carries an explicit ASCII id**, the same one
// its English page uses — `## プリロード {#preloading}`. This is not a style
// choice. VitePress slugifies through NFKD, which *decomposes* voiced kana, so
// the id it emits for `プリロード` starts フ+U+309A… and a hand-written
// `#プリロード` never matches the heading it points at. Nothing catches it
// either: VitePress's dead-link check does not look at anchors at all.
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

  // mermaid 11.17 pulls in fastdom, which is CommonJS and is not on VitePress's
  // own pre-bundle list. Left out, the dev server hands the browser the raw file
  // and the import of its default export throws at module scope — the whole site
  // renders blank, not just the diagrams. `vitepress build` is unaffected, since
  // Rollup handles CJS: this is one of the few faults a green build cannot see.
  //
  // Both specifiers are needed. mermaid imports the package *and* the subpath,
  // and pre-bundling one leaves the other served raw — the second failure looks
  // identical to the first, so fixing only `fastdom` reads as no fix at all.
  vite: {
    optimizeDeps: {
      include: ['fastdom', 'fastdom/extensions/fastdom-promised.js'],
    },
  },

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
          { text: 'Going further', link: '/usage/events' },
          { text: 'API', link: '/api-guide' },
          {
            text: 'More',
            items: [
              { text: 'Troubleshooting', link: '/troubleshooting' },
              { text: 'Limitations & Scope', link: '/limitations' },
              { text: 'License & notices', link: '/licenses' },
              { text: 'Working from a checkout', link: '/development/from-source' },
            ],
          },
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
              { text: 'Performance', link: '/usage/performance' },
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
              { text: 'License & notices', link: '/licenses' },
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

    ja: {
      label: '日本語',
      lang: 'ja',
      link: '/ja/',
      // Without this every ja page inherits the top-level English description
      // into its <meta> and Open Graph tags.
      description: 'SpriteStudio 7 のアニメーションを React Native で再生するプレイヤー（Nitro Modules + React Native Skia）',
      themeConfig: {
        outline: { level: [2, 3], label: '目次' },
        nav: [
          { text: 'はじめに', link: '/ja/setup/install' },
          { text: '使い方', link: '/ja/usage/basic' },
          { text: 'さらに進む', link: '/ja/usage/events' },
          { text: 'API', link: '/ja/api-guide' },
          {
            text: 'その他',
            items: [
              { text: 'トラブルシューティング', link: '/ja/troubleshooting' },
              { text: '制約と適用範囲', link: '/ja/limitations' },
              { text: 'ライセンスと表記', link: '/ja/licenses' },
              { text: 'チェックアウトから動かす', link: '/ja/development/from-source' },
            ],
          },
        ],
        sidebar: [
          {
            text: 'はじめに',
            items: [
              { text: 'インストール', link: '/ja/setup/install' },
              { text: 'クイックスタート', link: '/ja/setup/quickstart' },
              { text: 'アセットの準備（.sspj → .ssab）', link: '/ja/setup/assets' },
            ],
          },
          {
            text: '使い方',
            items: [
              { text: '基本的な再生', link: '/ja/usage/basic' },
              { text: '再生の制御', link: '/ja/usage/transport' },
              { text: '複数アニメーション: シーン', link: '/ja/usage/scene' },
            ],
          },
          {
            text: 'さらに進む',
            items: [
              { text: 'イベントとユーザーデータ', link: '/ja/usage/events' },
              { text: 'パーツの上書きと追従', link: '/ja/usage/parts' },
              { text: 'テクスチャとリソース', link: '/ja/usage/textures' },
              { text: 'Reanimated', link: '/ja/usage/reanimated' },
              { text: 'パフォーマンス', link: '/ja/usage/performance' },
            ],
          },
          {
            text: 'API リファレンス',
            items: [
              { text: 'どこから見るか', link: '/ja/api-guide' },
              { text: 'コンポーネント早見', link: '/ja/components' },
              // Language-neutral, so both locales share the one TypeDoc build.
              { text: '生成リファレンス', link: '/api/' },
            ],
          },
          {
            text: '困ったときと制約',
            items: [
              { text: 'トラブルシューティング', link: '/ja/troubleshooting' },
              { text: '制約と適用範囲', link: '/ja/limitations' },
              { text: 'ライセンスと表記', link: '/ja/licenses' },
            ],
          },
          {
            text: '開発',
            items: [
              { text: 'チェックアウトから動かす', link: '/ja/development/from-source' },
              { text: 'このリポジトリで作業する', link: `${GITHUB}/blob/main/AGENTS.md` },
            ],
          },
        ],
      },
    },
  },
})
