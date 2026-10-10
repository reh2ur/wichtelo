# Glacier Mark — Design Spec

Full design reference for Wichtelo app. Read before building new UI.

Source mock: `design-proposals/4a-v-glacier-mark.html`. Replaces old "Festive Pine" theme (pine-green/gold, candy stripe) — deprecated, don't reintroduce.

---

## Palette

### Custom glacier-mark tokens (hex, CSS vars + Tailwind utilities)

| Token            | Hex       | Tailwind                     | Use                                                                                                                           |
| ---------------- | --------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `--navy`         | `#16283f` | `bg-navy`, `text-navy`       | Foreground text, header bg (solid use)                                                                                        |
| `--navy-dark`    | `#0d1a2b` | `bg-navy-dark`               | Avatar/placeholder bg fallback                                                                                                |
| `--navy-soft`    | `#3d5872` | `text-navy-soft`             | Secondary/muted text (darkened for 4.5:1 AA vs lightest gradient stop, issue #110)                                            |
| `--crimson`      | `#df4a5e` | `bg-crimson`, `text-crimson` | Primary CTA, drawn-state badge, accent                                                                                        |
| `--success`      | `#1e8a5f` | `bg-success`, `text-success` | Open-state badge                                                                                                              |
| `--ice`          | `#e3eef8` | `bg-ice`                     | Page background base tone                                                                                                     |
| `--danger-text`  | `#b83247` | `text-danger-text`           | Error text. 5.9:1 on white, 5.0:1 on `--ice`. `--destructive`/`--crimson` too light for text (3.4–4.0:1) — fills/borders only |
| `--success-text` | `#17704d` | `text-success-text`          | Success text. 6.1:1 on white, 5.2:1 on `--ice`. Never `text-emerald-*` (3.2:1)                                                |

Not tokenized (used inline only, body gradient/blobs): `--sky-1 #8fc3ea`, `--sky-2 #bfe0f5`.

### Semantic tokens (shadcn-style, light mode)

| Token                  | Value                    | Mapped use                      |
| ---------------------- | ------------------------ | ------------------------------- |
| `--background`         | `#e3eef8`                | Icy page bg (under gradient)    |
| `--foreground`         | `#16283f`                | Navy body text                  |
| `--card`               | `rgb(255 255 255 / 60%)` | Frosted glass card surface      |
| `--popover`            | `rgb(255 255 255 / 92%)` | Menus/dropdowns, more opaque    |
| `--primary`            | `#df4a5e`                | Primary buttons (= `--crimson`) |
| `--primary-foreground` | `#fffaf9`                | Text on primary                 |
| `--accent`             | `#8fc3ea`                | Accent sky-blue elements        |
| `--muted`              | `#eef5fb`                | Subtle bg surfaces              |
| `--muted-foreground`   | `#3d5872`                | Navy-soft secondary text        |
| `--border`             | `rgb(22 40 63 / 14%)`    | Borders, dividers, inputs       |
| `--destructive`        | `#df4a5e`                | Danger actions (= `--crimson`)  |
| `--radius`             | `1.25rem` (20px)         | Base radius for cards/buttons   |

### Dark mode

Untouched, still neutral slate (not themed for navy/crimson). Avoid dark-mode-specific glacier assumptions.

---

## Typography

- **Font**: Manrope via `next/font/google`, variable `--font-manrope`
- **Applied**: `font-(family-name:--font-manrope)` on `<body>`
- **Weights**: 600 body, 700 labels/nav, 800 headings (`font-extrabold`)
- **Mono**: Geist (variable `--font-sans` — legacy naming, don't rename)
- **Emails**: same Manrope stack, inline hex fallback chain (`emails/components/theme.ts`) — email clients don't reliably load web fonts

---

## Icon system

- Package: `@phosphor-icons/react/ssr` (SSR-safe)
- Always use `Icon`-suffixed exports: `ArrowLeftIcon` not `ArrowLeft` (bare exports deprecated)
- `weight="duotone"` — decorative/feature icons, hero icons
- `weight="regular"` — inline text icons, dense UI

---

## Glass-card system

`app/globals.css` extends Tailwind's `.bg-card`/`.bg-popover` utilities w/ `backdrop-filter: blur(18px) saturate(160%)` + soft inset/drop shadow — global, automatic. Any element using `bg-card` gets frosted glass free, no per-component work.

`.bg-primary` also gets crimson→pink gradient overlay (`linear-gradient(135deg, var(--crimson), #f0808f)`) atop flat `--primary` color — applies to every primary button + account avatar (reuses `bg-primary`).

Page bg: `body` gets fixed sky gradient (`linear-gradient(175deg, #8fc3ea, #bfe0f5 40%, #a8d2ee 65%, #6fa8d8 85%, #4a86c2 100%)`) + two blurred blob accents via `body::before`/`::after` (pure CSS, no DOM). Don't duplicate per-page — global.

---

## Accessibility rules

- Error `<p>` → `role="alert"`, `text-danger-text`. Success `<p>` → `role="status"`, `text-success-text`.
- Inline confirm panels: title `<p tabIndex={-1}>` gets focus on open, trigger gets focus back on cancel. Use `useConfirmFocus` (`lib/use-confirm-focus.ts`) + `CONFIRM_TITLE_CLASS`.
- Never bare `outline-none` on focusable element — pair with `focus-visible:ring-*`.
- Snow hidden under `prefers-reduced-motion: reduce` (`.snow` rule in `globals.css`).
- Confirm panel pattern (first draw, redraw, leave, promote): `border-border bg-muted/30` box, title, muted message, confirm + outline cancel. Destructive actions use `border-destructive/30 bg-destructive/5`.

---

## Animations

| Name   | Keyframe                                  | Use                            |
| ------ | ----------------------------------------- | ------------------------------ |
| `fall` | `translateY(110vh) rotate(540deg)` + fade | Snow flakes (`Snow` component) |

---

## Components

### `components/nav.tsx`

Server component. Single-layer sticky glass header — no candy stripe (removed, Festive Pine relic).

`sticky top-0 z-20`, `bg-white/50 backdrop-blur-xl backdrop-saturate-150`, thin `border-white/60` bottom border. Left: `wichtelo-logo.png` wordmark (`public/brand/wichtelo-logo.png`, `next/image`, `h-11 w-auto`) — logo already carries the brand name, no separate text label needed. Right: initials avatar (`bg-primary text-primary-foreground`, 36×36px circle, white 2px border) or "Anmelden" link. Structural header synchronous; only account control streams.

### `components/footer.tsx`

Full-width winter-landscape SVG strip (`public/brand/footer-landscape.svg`, `next/image fill`) at the very bottom of every page. Impressum/Datenschutz links overlaid `absolute bottom-3` (12px from bottom), centered, `text-gray-400` (subtle), sit on white ground band of landscape art.

### `components/snow.tsx`

`'use client'`. Fixed-position overlay, `pointer-events-none`, `z-0`. 12 hardcoded flakes (❄/❅ chars), varied `left`/`delay`/`duration`/`fontSize`. `fall` keyframe. Color `rgba(255,255,255,0.88)` + `text-shadow: 0 0 5px rgba(169,205,236,0.6)` for icy glow.

Mounted in `app/layout.tsx` before main content. Content sits at `z-[1]` to layer above snow.

### `components/ui/button.tsx`

CVA-based, wraps Base UI `ButtonPrimitive`.

**Variants**: `default` (crimson gradient), `outline`, `secondary`, `ghost`, `destructive`, `link`

**Sizes**: `default` (h-8), `xs` (h-6), `sm` (h-7), `lg` (h-9), `icon` (8×8), `icon-xs`, `icon-sm`, `icon-lg`

Use `default` variant for primary CTAs. Use `destructive` for danger actions (soft red tint, not solid red).

### `components/ui/input-otp.tsx`

OTP slot input for magic-link verification. Use on `/anmelden` OTP entry.

---

## Christmas decoration rules

- **Snow overlay**: global via layout, opt-out not supported. Don't add second snow instance.
- **Logo**: use `wichtelo-logo.png` wordmark in the nav; static so brand feels stable while page loads. Don't reintroduce old SVG gift-mark icon (`components/logo-mark.tsx` deleted).
- **Landscape footer**: global via `Footer` component. Don't duplicate per-page.
- **Decorative components are integrated at layout level** — new feature components don't need to opt in to Christmas chrome; it's ambient.

---

## Common UI patterns

| Need                     | Reach for                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Primary action           | `<Button>` (default variant)                                                                                     |
| Danger action            | `<Button variant="destructive">`                                                                                 |
| Quiet action             | `<Button variant="ghost">` or `variant="outline"`                                                                |
| OTP entry                | `components/ui/input-otp.tsx`                                                                                    |
| State chips (open/drawn) | Inline `<span>` with `bg-success/10 text-success` (open) or `bg-crimson/10 text-crimson` (drawn)                 |
| Member initials          | Inline circle div: `bg-crimson/10 text-crimson border-crimson` (admin) or `bg-secondary text-navy` (participant) |
| Empty list               | Inline empty state with muted text + relevant icon                                                               |

For inputs, textareas, cards, badges — no shared component yet. Use Tailwind semantic tokens directly: `bg-card border-border rounded-lg` (glass auto-applies via global `.bg-card` rule).

---

## Token usage quick-ref

```
bg-primary          → CTAs, avatar (crimson gradient, auto)
bg-card             → glass surfaces (frosted blur, auto)
bg-success          → open-state badge
bg-crimson          → drawn-state badge, danger accents
text-navy-soft      → secondary/helper text (= text-muted-foreground)
bg-background       → page base tone (gradient layered on top via body)
border-border       → all borders
```
