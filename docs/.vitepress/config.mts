import { defineConfig } from 'vitepress';

export default defineConfig({
    title: 'XRSPS',
    description: 'Build gamemodes and extrascripts for OSRS in the browser',
    base: '/',
    head: [
        ['meta', { property: 'og:title', content: 'XRSPS' }],
        ['meta', { property: 'og:description', content: 'Build gamemodes and extrascripts for OSRS in the browser' }],
        ['meta', { name: 'theme-color', content: '#4a9eff' }],
    ],
    themeConfig: {
        logo: '/xrsps.png',
        siteTitle: false,
        nav: [
            { text: 'Home', link: '/' },
            { text: 'Docs', link: '/setup' }
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
            {
                text: 'Reference',
                collapsed: false,
                items: [
                    { text: 'Overview', link: '/reference/' },
                    { text: '00 — Overview', link: '/reference/00-overview' },
                    { text: '01 — Repo map', link: '/reference/01-repo-map' },
                    { text: '02 — Architecture', link: '/reference/02-architecture' },
                ],
            },
            {
                text: '10 — Client',
                collapsed: true,
                items: [
                    { text: 'Index', link: '/reference/10-client/' },
                    { text: '01 — Entry & lifecycle', link: '/reference/10-client/01-entry-and-lifecycle' },
                    { text: '02 — rs/ engine', link: '/reference/10-client/02-rs-engine' },
                    { text: '03 — WebGL renderer', link: '/reference/10-client/03-webgl-renderer' },
                    { text: '04 — UI widgets', link: '/reference/10-client/04-ui-widgets' },
                    { text: '05 — Input & camera', link: '/reference/10-client/05-input-camera' },
                    { text: '06 — Sync & movement', link: '/reference/10-client/06-sync-movement' },
                    { text: '07 — Audio', link: '/reference/10-client/07-audio' },
                    { text: '08 — Login', link: '/reference/10-client/08-login' },
                    { text: '09 — Plugins & overlays', link: '/reference/10-client/09-plugins-overlays' },
                    { text: '10 — Networking', link: '/reference/10-client/10-networking' },
                    { text: '11 — Worker pool', link: '/reference/10-client/11-worker-pool' },
                ],
            },
            {
                text: '20 — Server',
                collapsed: true,
                items: [
                    { text: 'Index', link: '/reference/20-server/' },
                    { text: '01 — Startup', link: '/reference/20-server/01-startup' },
                    { text: '02 — Tick system', link: '/reference/20-server/02-tick-system' },
                    { text: '03 — Services', link: '/reference/20-server/03-services' },
                    { text: '04 — Player state', link: '/reference/20-server/04-player-state' },
                    { text: '05 — NPCs', link: '/reference/20-server/05-npcs' },
                    { text: '06 — Combat', link: '/reference/20-server/06-combat' },
                    { text: '07 — Movement & pathfinding', link: '/reference/20-server/07-movement-pathfinding' },
                    { text: '08 — World', link: '/reference/20-server/08-world' },
                    { text: '09 — Network', link: '/reference/20-server/09-network' },
                    { text: '10 — Persistence', link: '/reference/20-server/10-persistence' },
                    { text: '11 — Gamemode loader', link: '/reference/20-server/11-gamemode-loader' },
                    { text: '12 — Script runtime', link: '/reference/20-server/12-script-runtime' },
                    { text: '13 — Data files', link: '/reference/20-server/13-data-files' },
                ],
            },
            {
                text: '30 — Shared',
                collapsed: true,
                items: [
                    { text: 'Index', link: '/reference/30-shared/' },
                ],
            },
            {
                text: '40 — Protocol',
                collapsed: true,
                items: [
                    { text: 'Index', link: '/reference/40-protocol/' },
                    { text: '01 — Connection lifecycle', link: '/reference/40-protocol/01-connection-lifecycle' },
                    { text: '02 — Binary encoding', link: '/reference/40-protocol/02-binary-encoding' },
                    { text: '03 — Client → server', link: '/reference/40-protocol/03-client-to-server' },
                    { text: '04 — Server → client', link: '/reference/40-protocol/04-server-to-client' },
                    { text: '05 — Sync bitstreams', link: '/reference/40-protocol/05-sync-bitstreams' },
                ],
            },
            {
                text: '50 — Gamemodes & scripts',
                collapsed: true,
                items: [
                    { text: 'Index', link: '/reference/50-gamemodes-scripts/' },
                    { text: '01 — Gamemode API', link: '/reference/50-gamemodes-scripts/01-gamemode-api' },
                    { text: '02 — Script registry', link: '/reference/50-gamemodes-scripts/02-script-registry' },
                    { text: '03 — Extrascripts', link: '/reference/50-gamemodes-scripts/03-extrascripts' },
                    { text: '04 — Custom widgets', link: '/reference/50-gamemodes-scripts/04-custom-widgets' },
                    { text: '05 — Built-in gamemodes', link: '/reference/50-gamemodes-scripts/05-builtin-gamemodes' },
                    { text: '06 — Content data', link: '/reference/50-gamemodes-scripts/06-content-data' },
                ],
            },
            {
                text: '60 — Build, run & deploy',
                collapsed: true,
                items: [
                    { text: 'Index', link: '/reference/60-build-run-deploy/' },
                    { text: '01 — Local dev', link: '/reference/60-build-run-deploy/01-local-dev' },
                    { text: '02 — Scripts reference', link: '/reference/60-build-run-deploy/02-scripts-reference' },
                    { text: '03 — Cache', link: '/reference/60-build-run-deploy/03-cache' },
                    { text: '04 — mprocs', link: '/reference/60-build-run-deploy/04-mprocs' },
                    { text: '05 — Deploy', link: '/reference/60-build-run-deploy/05-deploy' },
                    { text: '06 — Observability', link: '/reference/60-build-run-deploy/06-observability' },
                ],
            },
            {
                text: '70 — Worked examples',
                collapsed: true,
                items: [
                    { text: 'Index', link: '/reference/70-examples/' },
                    { text: '01 — First run', link: '/reference/70-examples/01-first-run' },
                    { text: '02 — Add an NPC', link: '/reference/70-examples/02-add-npc' },
                    { text: '03 — Chat command', link: '/reference/70-examples/03-chat-command' },
                    { text: '04 — Extrascript', link: '/reference/70-examples/04-extrascript' },
                    { text: '05 — Gamemode', link: '/reference/70-examples/05-gamemode' },
                    { text: '06 — Packet handler', link: '/reference/70-examples/06-packet-handler' },
                    { text: '07 — Custom widget', link: '/reference/70-examples/07-custom-widget' },
                    { text: '08 — Render overlay', link: '/reference/70-examples/08-render-overlay' },
                    { text: '09 — Cache export', link: '/reference/70-examples/09-cache-export' },
                ],
            },
            {
                text: '80 — LLM quick index',
                collapsed: true,
                items: [
                    { text: 'Index', link: '/reference/80-llm/' },
                    { text: '01 — Glossary', link: '/reference/80-llm/01-glossary' },
                    { text: '02 — File index', link: '/reference/80-llm/02-file-index' },
                    { text: '03 — Symbol table', link: '/reference/80-llm/03-symbol-table' },
                    { text: '04 — Quick lookup', link: '/reference/80-llm/04-quick-lookup' },
                    { text: '05 — Conventions', link: '/reference/80-llm/05-conventions' },
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
