# Design System — YouTube Personas

## Product Context
- **What this is:** A web app for talking to AI "digital duplicates" of YouTube monologue creators, grounded in their own videos via RAG.
- **Who it's for:** The owner + a small invited team (2-20 people, allowlist).
- **Space/industry:** AI tooling adjacent to creator research / persona analysis. Peers in feel: Granola, Linear, Notion, Claude.ai, Read.ai. Peers in subject: Character.ai, Inflection's Pi, custom GPTs.
- **Project type:** Internal web app (workflow + chat). Cloudflare Workers + Supabase + React/Vite.

## Aesthetic Direction
- **Direction:** Editorial-warm productive — Granola × Linear × The New Yorker.
- **Decoration level:** Intentional. Hairline warm borders, subtle paper-grain on persona cards, no purple gradients, no blob shapes, no AI sparkles.
- **Mood:** A tool you sit with for an hour. Warm, considered, human. Productive without being clinical. Editorial without being precious.
- **Reference sites:** linear.app (spacing/rhythm), granola.ai (warm AI tool color), claude.ai (chat UX restraint), notion.so (tabular data that breathes), vercel.com (status communication).
- **Anti-patterns (never ship):** purple/violet gradients, 3-column icon grids, "Built for X" hero copy, glowing sparkles on AI features, uniform bubble border-radius, generic dark-mode-with-teal-accent.

## Typography
- **Display/Hero:** **Fraunces** (variable serif, optical sizing 9..144) — gives personas gravitas and signals "editorial, not SaaS." Use opsz 144 + italic for emphasis spans inside titles.
- **Body:** **Inter Tight** (400/500/600/700) — modern, dense, readable at 12–18px. Good for table data.
- **UI/Labels:** Same as body (Inter Tight).
- **Data/Tables:** **JetBrains Mono** (400/500) for channel IDs, timestamps, technical fields. Use `font-variant-numeric: tabular-nums` on numeric table columns and stat values.
- **Code:** JetBrains Mono.
- **Loading:** Google Fonts (`<link>` from `fonts.googleapis.com`). Self-host if WPO becomes a concern.
- **Scale:** 12 / 14 / 16 / 18 / 22 / 28 / 36 / 48 / 64 (modular ratio ≈ 1.25).
- **Letter-spacing:** -0.02em on display sizes (28px+), 0 on body, +0.12em uppercase on mono eyebrow labels.

## Color
- **Approach:** Restrained. One brand accent, warm neutrals, semantic colors for state, per-persona accents derived from channel ID hash.
- **CSS custom property names** (use these exact names in code):
  ```css
  --bg: #FBF7F2;            /* warm off-white, paper feel */
  --surface: #FFFFFF;       /* cards, panels */
  --surface-2: #F4EEE5;     /* hover, subtle wash */
  --border: #E8E0D5;        /* warm hairline */
  --border-strong: #D4C9B8; /* emphasized borders, inputs */
  --ink: #1A1816;           /* primary text, warm charcoal */
  --ink-2: #3A3530;         /* secondary text */
  --muted: #6B6660;         /* muted text, captions */
  --muted-2: #9A9388;       /* most muted */
  --accent: #C8553D;        /* terracotta — CTAs, active state, links */
  --accent-hover: #B04632;
  --accent-soft: #F7E6E0;   /* accent backgrounds (active row, focus ring) */
  --success: #3F7A4D;
  --success-soft: #E4EFE6;
  --warning: #C77F1C;
  --warning-soft: #F9ECD4;
  --error: #A93838;
  --error-soft: #F4DDDD;
  --info: #3D6B8F;
  --info-soft: #DCE7F0;
  ```
- **Dark mode** (override `:root[data-theme="dark"]`):
  ```css
  --bg: #1C1816;
  --surface: #25201D;
  --surface-2: #2E2925;
  --border: #3A332D;
  --border-strong: #4A413A;
  --ink: #F4EEE5;
  --ink-2: #D4C9B8;
  --muted: #9A9388;
  --muted-2: #6B6660;
  --accent: #D9685A;        /* slightly desaturated for dark canvas */
  --accent-hover: #E07B6E;
  --accent-soft: #3A2622;
  --success: #5DA070;
  --warning: #D99947;
  --error: #C45A5A;
  --info: #6595BA;
  ```
- **Default theme:** LIGHT. This is a deliberate departure from the AI-chat category, which defaults dark. Reason: this product is about human warmth, not sci-fi sophistication. Dark mode is a user-toggleable preference, persisted in `localStorage`.
- **Per-persona accents:** derived from `channel_id` hash → pick from a curated palette (e.g. `#3D6B8F` blue, `#3F7A4D` green, `#C77F1C` amber, `#8B5A9F` violet, `#A93838` brick, `#6B6660` slate). Avatar background, persona-card border-left, persona-page highlights.

## Spacing
- **Base unit:** 4px.
- **Density:** comfortable (not tight, not airy).
- **Scale (px):** 2 / 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96.
- **Typical paddings:** cards 16-20px, page main 24-32px, sidebar items 7-10px, table cells 14-16px.
- **Gap rules:** related groups 8px, distinct groups 16-24px, sections 48-96px.

## Layout
- **Approach:** Hybrid. App surfaces (Dashboard, Channels) grid-disciplined; Persona/Chat surfaces editorial.
- **App shell:** Sidebar 220-240px (collapsible to 56px icon rail) + main content `max-width: 1200px` with 24-32px horizontal padding.
- **Grid:** 12-column for content where needed; otherwise free layout within the 1200px frame.
- **Border radius:** sm 6px (buttons, inputs), md 10px (cards, panels), lg 16px (mockup-style frames), full 9999px (pills, avatars).
- **Shadows:** two-layer warm shadows (rgba(26,24,22,.04) — never pure black). `--shadow-sm` for cards, `--shadow-md` for elevated surfaces / modals.
- **Border style:** hairline (1px solid `--border`); never use 2px+ borders except for focus states.

## Motion
- **Approach:** Intentional. State changes get motion; ambient/decoration does not.
- **Easing:** enter `ease-out`, exit `ease-in`, move `ease-in-out`. For state changes use a soft spring (cubic-bezier(0.32, 0.72, 0, 1)).
- **Duration:** micro 100ms (hover/press), short 150-250ms (component state), medium 250-400ms (page transitions), long 400-700ms (only for celebratory moments).
- **Status updates:** sliding tabular numbers (Vercel-style "Ingesting… 12/50"). No spinners where a number can update.
- **Reduced motion:** respect `prefers-reduced-motion: reduce` everywhere — replace transitions with instant changes.
- **Never:** pulsing AI sparkles, gradient borders that shimmer, parallax, scroll-jacking.

## Component Vocabulary

### Buttons
- `btn-primary` — accent background, white text. Use for the one primary action per surface.
- `btn-secondary` — surface background, ink text, `border-strong` border. Use for confirming-but-not-primary actions.
- `btn-ghost` — transparent background, hairline border, ink-2 text. Use for tertiary actions.
- `btn-sm` modifier reduces padding and font-size.
- Always include `:active { transform: translateY(1px) }` for tactile feedback.

### Pills (status)
- `pill-success` / `pill-warning` / `pill-error` / `pill-info` / `pill-neutral` — all use the matching `*-soft` background and the solid color for text.
- Include a 6px `dot` matching the text color for fast scanning.

### Inputs
- Default: `bg`, `border-strong`, 10-11px padding, 14px font.
- Focus: `border-color: accent` + `box-shadow: 0 0 0 3px accent-soft` (focus ring). Use `:focus-visible`, not `:focus`.

### Cards
- `surface` background, 1px `border`, `radius-md`, `shadow-sm`, 16-20px padding.
- No multi-color borders or gradient backgrounds.

### Avatars
- sm 24-28px, md 36-40px, lg 44-56px. All circles. Background uses the derived persona color. Text uses Fraunces 500, white.

### Tables
- Header row in `surface-2` background with mono uppercase 10-11px labels.
- 14-16px cell padding. Hairline borders between rows. Hover row tint: `surface-2` at 50% opacity.
- Numeric columns right-aligned, mono font, tabular-nums.

### Chat bubbles
- User: `accent` bg, white text, `border-bottom-right-radius: 6px`.
- Assistant: `surface` bg, `ink` text, hairline border, `shadow-sm`, `border-bottom-left-radius: 6px`.
- Citations rendered as a dashed-top-bordered block at the bottom of the assistant bubble, mono 11px, accent links.

## Accessibility (non-negotiable)
- All interactive elements have `:focus-visible` ring (`box-shadow: 0 0 0 3px accent-soft` + accent border).
- Form inputs have explicit `<label>` (`sr-only` if visually hidden), `id`, `name`, and `autoComplete` where applicable.
- Live regions (`aria-live="polite"`) on stats, activity feed, chat stream, and status messages.
- Respect `prefers-reduced-motion`.
- Color is never the sole carrier of meaning — pair color with text or icon.
- Maintain ≥ 4.5:1 contrast for body text against canvas. Test both themes.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-26 | System created via `/design-consultation` | User rejected the original dark/red Tailwind defaults as bland and AI-generated. New direction: editorial-warm productive with light default, Fraunces serif, terracotta accent, per-persona derived colors. Approved after preview-page review. |
| 2026-05-26 | LIGHT mode default | Deliberate departure from AI-chat category convention. Reason: this product is about human warmth, not sci-fi sophistication. |
| 2026-05-26 | Per-persona derived accent colors | The product's value prop is creator identity; UI should signal that personas are distinct entities, not faceless assistants. |
