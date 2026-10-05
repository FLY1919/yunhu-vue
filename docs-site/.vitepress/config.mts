import { defineConfig } from 'vitepress'

export default defineConfig({
  // ⚠️ 部署到 GitHub Pages 的项目站点（https://<user>.github.io/<repo>/）时必须是 '/<仓库名>/'
  base: '/yunhu-vue/',
  title: '云湖第三方客户端',
  description: 'Vue3 + cordis 内核 + Koishi 式控制台 + Satori 消息层的云湖 Web 客户端',
  lang: 'zh-CN',
  lastUpdated: true,
  cleanUrls: true,

  head: [['meta', { name: 'theme-color', content: '#5a8cf8' }]],

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '指南', link: '/guide/getting-started' },
      {
        text: '文档',
        items: [
          { text: '插件开发', link: '/guide/plugin-development' },
          { text: '消息元素（Satori）', link: '/guide/satori' },
          { text: '接口覆盖', link: '/guide/api-coverage' },
          { text: 'cordis 实测笔记', link: '/guide/cordis-notes' },
        ],
      },
      { text: 'GitHub', link: 'https://github.com/FLY1919/yunhu-vue' },
    ],

    sidebar: [
      {
        text: '开始',
        items: [
          { text: '项目简介', link: '/' },
          { text: '快速开始', link: '/guide/getting-started' },
        ],
      },
      {
        text: '开发',
        items: [
          { text: '插件开发指南', link: '/guide/plugin-development' },
          { text: '消息元素（Satori）', link: '/guide/satori' },
        ],
      },
      {
        text: '参考',
        items: [
          { text: '接口覆盖情况', link: '/guide/api-coverage' },
          { text: 'cordis 实测笔记', link: '/guide/cordis-notes' },
        ],
      },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/FLY1919/yunhu-vue' }],

    footer: {
      message: '基于社区公开接口整理，仅供学习交流 · Released under the MIT License.',
      copyright: 'Copyright © 2026 FLY1919',
    },

    search: { provider: 'local' },

    outline: { level: [2, 3] },

    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdatedText: '最后更新',
    outlineTitle: '本页目录',
    darkModeSwitchLabel: '主题',
    returnToTopLabel: '回到顶部',
  },
})
