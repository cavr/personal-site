import { defineConfig } from 'astro/config';
// Note: @astrojs/sitemap integration is available but currently disabled
// due to a compatibility issue. Enable when updating Astro.
// import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
    site: 'https://cavr.github.io',
    base: '/personal-site/',
    // integrations: [sitemap()],
});
