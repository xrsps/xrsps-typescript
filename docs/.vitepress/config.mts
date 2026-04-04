import { defineConfig } from 'vitepress';

export default defineConfig({
    title: 'XRSPS',
    description: 'OSRS Leagues V - 1:1 TypeScript Remake',
    base: '/',
    head: [
        ['meta', { property: 'og:title', content: 'XRSPS' }],
        ['meta', { property: 'og:description', content: 'A community-driven 1:1 OSRS Leagues V remake in TypeScript' }],
        ['meta', { name: 'theme-color', content: '#4a9eff' }],
    ],
    themeConfig: {
        nav: [
            { text: 'Home', link: '/' },
            { text: 'Setup', link: '/setup' },
            { text: 'Architecture', link: '/ARCHITECTURE' },
            { text: 'FAQ', link: '/faq' },
        ],
        sidebar: [
            {
                text: 'Getting Started',
                items: [
                    { text: 'Setup', link: '/setup' },
                    { text: 'FAQ', link: '/faq' },
                ],
            },
            {
                text: 'Documentation',
                items: [
                    { text: 'Architecture', link: '/ARCHITECTURE' },
                    { text: 'Gamemodes', link: '/gamemodes' },
                    { text: 'Extrascripts', link: '/extrascripts' },
                ],
            },
        ],
        socialLinks: [
            { icon: 'discord', link: 'https://discord.gg/3dzttF2q73' },
            { icon: 'github', link: 'https://github.com/xrsps/xrsps-typescript' },
        ],
        footer: {
            message: 'Fan project. Not affiliated with Jagex Ltd.',
        },
        editLink: {
            pattern: 'https://github.com/xrsps/xrsps-typescript/edit/main/docs/:path',
            text: 'Edit this page on GitHub',
        },
    },
});
