import { defineConfig } from 'vitepress';

export default defineConfig({
    title: 'XRSPS',
    description: 'OSRS Leagues V Documentation',
    base: '/xrsps-typescript/',
    themeConfig: {
        nav: [
            { text: 'Home', link: '/' },
            { text: 'Architecture', link: '/ARCHITECTURE' },
            { text: 'WorldView', link: '/WORLDVIEW' },
        ],
        sidebar: [
            {
                text: 'Documentation',
                items: [
                    { text: 'Architecture', link: '/ARCHITECTURE' },
                    { text: 'WorldView', link: '/WORLDVIEW' },
                ],
            },
        ],
        socialLinks: [
            { icon: 'github', link: 'https://github.com/xrsps/xrsps-typescript' },
        ],
    },
});
