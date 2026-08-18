---
name: Chronos Flow
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#424754'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#727785'
  outline-variant: '#c2c6d6'
  surface-tint: '#005ac2'
  primary: '#0058be'
  on-primary: '#ffffff'
  primary-container: '#2170e4'
  on-primary-container: '#fefcff'
  inverse-primary: '#adc6ff'
  secondary: '#5c5f61'
  on-secondary: '#ffffff'
  secondary-container: '#e0e3e5'
  on-secondary-container: '#626567'
  tertiary: '#006947'
  on-tertiary: '#ffffff'
  tertiary-container: '#00855b'
  on-tertiary-container: '#f5fff6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#004395'
  secondary-fixed: '#e0e3e5'
  secondary-fixed-dim: '#c4c7c9'
  on-secondary-fixed: '#191c1e'
  on-secondary-fixed-variant: '#444749'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-lg:
    fontFamily: Manrope
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Manrope
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  body-base:
    fontFamily: Manrope
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Manrope
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 8px
  container-padding: 24px
  gutter: 16px
  card-gap: 20px
  timeline-inset: 64px
---

## Brand & Style

The design system focuses on a **Modern Minimalist** aesthetic specifically tailored for narrative and timeline management. It prioritizes clarity and calm over density, ensuring that complex chronological data feels approachable and organized.

The UI utilizes heavy whitespace to separate distinct timeline events, reducing cognitive load for the user. By employing compact soft rounded corners, subtle transitions, and a dark glass floating-window shell, the interface moves away from the "backend dashboard" feel and toward a sophisticated, consumer-grade management tool. The emotional response should be one of "effortless control"—where the timeline is a fluid canvas rather than a rigid table.

### Appearance Mode

Chronos Flow is **Dark-first**, and the currently frozen UI is **Dark-only**. The semantic palette keeps light-surface tokens for naming consistency and possible future use, but the current release does not promise or require a Light Mode implementation. Do not redesign frozen screens to add Light Mode unless the product requirement is explicitly reopened.

## Colors

The current frozen interface uses the dark side of the semantic palette exclusively. Color tokens remain semantic, but the shipping visual baseline is the dark glass interface shown in the frozen HTML screens.

- **Primary (Timeline Blue):** Used for the chronological axis, primary actions, and active navigation states. It represents the "flow" of time.
- **Secondary (Surface):** Dark navy/charcoal tonal surfaces and low-opacity white overlays separate cards from the canvas without introducing heavy contrast.
- **Status Indicators:** Avoid high-vibrancy alerts. Use desaturated, soft background washes for status badges:
    - **Success (Auto/Normal):** Mint green background with dark green text.
    - **Warning (Manual/Conflict):** Soft apricot background with amber text.
    - **Error (Break/Missing):** Pale rose background with muted crimson text.

## Typography

The typography strategy utilizes **Manrope** for its excellent legibility and modern, slightly rounded geometric character, which aligns with the minimalist brand style.

- **Headlines:** Use a tighter letter-spacing and bold weights to ground the page sections.
- **Body:** Standardized on a 16px base for long-form narrative descriptions or log entries to ensure eye comfort.
- **Labels:** Technical metadata, timestamps, and version numbers use **JetBrains Mono** to provide a distinct "data" feel without being visually overwhelming. This helps differentiate between user-generated content and system-generated metadata.

## Layout & Spacing

The layout follows a **Fluid Grid** model with high internal margins. The core of the interface is the "Timeline Track"—a vertical or horizontal spine that elements anchor to.

- **Margins:** Desktop views should maintain a 24px safety margin from the edge of the viewport.
- **Rhythm:** Spacing follows an 8px base unit. Card internal padding is 20px to maintain the "clean and airy" requirement.
- **Responsive Behavior:** On mobile, the timeline track stays at the far left with cards taking the remaining width. Split workspaces (such as Group and Settings) collapse to one column, summary grids reduce their column count, and page-header actions may stack or wrap. The primary Tab navigation remains available as a horizontally scrollable mobile row. Desktop restores the frozen multi-column layouts.

## Elevation & Depth

The frozen visual language is a **dark glass floating window** with lightweight inner surfaces. Depth comes from glass, tonal layering, low-contrast outlines, and restrained shadows rather than stacked dashboard cards.

- **Level 0 (Canvas):** The page canvas is `#0f172a`, with low-opacity blue/green ambient glows behind the plugin window.
- **Shell / Glass Panel:** `background: rgba(33, 49, 69, 0.85)`, `backdrop-filter: blur(16px)`, `-webkit-backdrop-filter: blur(16px)`, and `border: 1px solid rgba(194, 198, 214, 0.1)`.
- **Ambient Shell Shadow:** `0px 4px 20px rgba(0, 0, 0, 0.15)`. This shadow belongs to the floating plugin window and is part of the frozen baseline.
- **Level 1 (Static Cards / Sections):** Prefer tonal layering such as `bg-white/[0.03]` with low-contrast outlines such as `border-outline-variant/15`. Static structural panels normally do not need an additional drop shadow.
- **Hoverable Cards:** `.card-subtle` may move to `rgba(255,255,255,0.06)`, use `border-color: rgba(173,198,255,0.3)`, translate by `-2px`, and apply `0 8px 24px rgba(0,0,0,0.12)` on hover. Use this only where the card is genuinely interactive.
- **Level 2 (Modals/Popovers):** Use a stronger outline and a clearly stronger temporary-focus shadow than static content.
- **Navigation Glass:** The persistent top navigation keeps `backdrop-blur-md` (approximately 12px in the current Tailwind runtime) on top of the 16px glass shell.

## Shapes

The design system employs a **Rounded** shape language to soften the management experience.

- **Controls & Compact Cards:** `rounded-lg` resolves to **8px** in the frozen UI and is the standard radius for buttons, inputs, compact cards, and controls.
- **Major Sections & Shell:** `rounded-xl` resolves to **12px** and is used for larger panels, sections, dialogs, and the plugin window.
- **Tailwind Runtime:** `rounded-sm` follows the runtime default (**2px**), `rounded` is **4px**, and `rounded-md` follows the runtime default (**6px**). Do not substitute the older 16px/24px radius scale without reopening the visual design.
- **Status Badges:** Use `rounded-full` (Pill-shaped) to distinguish them clearly from interactive buttons.
- **Timeline Nodes:** Small circular shapes (dots) on the timeline track should be perfectly round to contrast against the rectangular cards.

## Components

### Navigation Bar
The top navigation is persistent. It features the Font Awesome `fa-timeline` brand icon on the far left, followed by the plugin name in **Headline-MD**. Desktop uses the standard tab row; mobile uses the same tab order in a horizontally scrollable row rather than a hamburger menu. Keep the blurred navigation surface distinct from scrolling content.

### Timeline Cards
The primary container for events. 
- **Header:** Contains the event title and the soft status badge.
- **Content:** Uses **Body-Base** for narrative text.
- **Footer:** Uses **Label-Caps** for the timestamp and author.

### State Badges
Pill-shaped elements with low-saturation backgrounds. Text should remain clearly legible against the badge surface. Existing Font Awesome status glyphs may be used for compact semantic badges (for example Auto or anomaly badges), but badges are **not required** to use Font Awesome. Preserve the frozen icon choice when a badge is already established.

### Iconography
- **Brand identity:** Font Awesome is reserved for the `fa-timeline` brand mark and a small number of already-frozen semantic/status glyphs.
- **Primary UI icon set:** Material Symbols is the default for functional actions, controls, navigation helpers, drag handles, warnings, edit actions, and general interface affordances.
- **Do not normalize for its own sake:** Do not convert every existing status icon to one library merely for visual purity. Preserve frozen choices unless there is a concrete consistency or accessibility issue.

### Interaction Elements
- **Buttons:** Primary buttons use the Timeline Blue with white text and a `rounded-lg` radius. Secondary buttons should be ghost-style (outline only).
- **Inputs:** Clean, 1px bordered boxes with `rounded-lg`. Focus states should use a 2px Timeline Blue glow.
- **Timeline Axis:** A 2px vertical line in a light neutral color, with nodes that highlight in Primary Blue when the associated card is hovered.

## Prototype Interaction Status

The current HTML bundle is a **fully clickable front-end prototype**. Navigation, group operations, timeline filtering/mode switching, AI draft interactions, log switching/clearing, and settings interactions are implemented in-browser with transient state.

These interactions are **prototype-only**:
- Refreshing a page restores sample data.
- No SillyTavern APIs, worldbook writes, chat state, or persistent configuration files are connected yet.
- Prototype behavior must not be treated as final data-layer behavior.
