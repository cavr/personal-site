# Personal Site — Claude Context

## Project Overview

Carlos Villanueva's personal site. Built with Astro, deployed to GitHub Pages at `https://cavr.github.io/personal-site/`.

## Stack

- **Framework:** Astro v4
- **Language:** TypeScript
- **Styling:** Plain CSS (global design system in `src/styles/global.css`)
- **Content:** Astro Content Collections (Markdown)
- **Deployment:** GitHub Pages — base path is `/personal-site/`
- **Analytics:** Cloudflare Web Analytics

## Commands

```bash
npm run dev      # start dev server at localhost:4321/personal-site/
npm run build    # type check + build
npm run preview  # preview production build
```

## Project Structure

```
src/
  content/
    config.ts          # content collection schemas
    work/              # work/project entries (.md)
    blog/              # blog post entries (.md)
  pages/
    index.astro        # homepage (hero, about, skills, work, play, contact)
    work.astro         # work listing page
    work/
      [...slug].astro  # individual work entry page
    blog/
      index.astro      # blog listing page
    blog/
      [...slug].astro  # individual blog post page
    about.astro
    play.astro
    404.astro
  layouts/
    BaseLayout.astro   # base HTML shell with fonts, global styles, analytics
  styles/
    global.css         # design system: CSS variables, typography, utilities
  components/          # shared components
public/
  assets/              # images
  favicon.svg
```

## Content Collections

### `work`

Fields: `title`, `description`, `publishDate`, `tags`, `img`, `img_alt?`

### `blog`

Fields: `title`, `description`, `publishDate`, `tags`

No image required for blog posts.

## URLs

All internal links must include the `/personal-site/` base path prefix.

```astro
<!-- Correct -->
<a href="/personal-site/blog/">Blog</a>

<!-- Wrong -->
<a href="/blog/">Blog</a>
```

## Adding a Blog Post

Create a markdown file in `src/content/blog/slug-here.md`:

```markdown
---
title: Your Post Title
description: |
  One or two sentence description shown in the listing and meta tags.
publishDate: 2026-01-01 00:00:00
tags:
  - Tag1
  - Tag2
---

Post content here in Markdown.
```

The slug is derived from the filename. The post will appear at `/personal-site/blog/slug-here/`.

## Design System

CSS variables are defined in `src/styles/global.css`. Key tokens:

- `--bg-primary` / `--bg-secondary` / `--bg-tertiary` — dark backgrounds
- `--text-primary` / `--text-secondary` / `--text-muted`
- `--accent-primary` — neon green `#00ff88`
- `--accent-secondary` — cyan `#00d4ff`
- `--font-mono` — JetBrains Mono
- `--glow-primary` / `--glow-secondary` — box-shadow glow effects

## Navigation

The main nav in `src/pages/index.astro` links: about, skills, work, play, blog, contact.

Blog and work detail pages have their own sticky nav with a back link.

## Notes

- `@astrojs/sitemap` is installed but disabled due to a compatibility issue — do not enable until Astro is updated
- The `.idea/` directory (JetBrains IDE) should stay in `.gitignore`
