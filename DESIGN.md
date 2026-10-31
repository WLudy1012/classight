---
name: Classight
description: A class name as dark pigment dispersed on a white page; two tones, one coral accent, hairline structure.
colors:
  bg-950: "#ffffff"
  bg-900: "#f7f8fa"
  bg-850: "#f0f2f6"
  bg-800: "#e9edf2"
  bg-700: "#dde3ea"
  bg-600: "#c6cfdb"
  fg-100: "#0b1220"
  fg-200: "#1e2837"
  fg-300: "#384456"
  fg-500: "#566173"
  fg-700: "#6b7686"
  accent: "#ff6a3d"
  accent-hover: "#ff8159"
  accent-press: "#ec5a2d"
  accent-ink: "#1a0903"
  danger: "#c42a47"
  success: "#1a7a4f"
  line: "rgba(11, 18, 32, 0.10)"
  line-strong: "rgba(11, 18, 32, 0.24)"
  glass-bg: "rgba(255, 255, 255, 0.50)"
  glass-bg-solid: "rgba(255, 255, 255, 0.96)"
  glass-edge: "rgba(11, 18, 32, 0.12)"
typography:
  display:
    fontFamily: "Geist Variable, Noto Sans SC, PingFang SC, Hiragino Sans GB, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Geist Variable, Noto Sans SC, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "Geist Variable, Noto Sans SC, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "Geist Variable, Noto Sans SC, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Geist Variable, Noto Sans SC, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.55
  caption:
    fontFamily: "Geist Variable, Noto Sans SC, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  sm: "6px"
  md: "10px"
  lg: "18px"
  pill: "999px"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "24px"
  s-6: "32px"
  s-7: "48px"
  s-8: "72px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-active:
    backgroundColor: "{colors.accent-press}"
  button-secondary:
    backgroundColor: "rgba(11, 18, 32, 0.04)"
    textColor: "{colors.fg-100}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.fg-100}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  input:
    backgroundColor: "rgba(11, 18, 32, 0.04)"
    textColor: "{colors.fg-100}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 12px"
  badge:
    textColor: "{colors.fg-300}"
    rounded: "{rounded.pill}"
    height: "22px"
    padding: "0 8px"
  dialog:
    backgroundColor: "{colors.glass-bg}"
    textColor: "{colors.fg-100}"
    rounded: "{rounded.lg}"
    width: "520px"
  dock:
    backgroundColor: "{colors.glass-bg}"
    textColor: "{colors.fg-100}"
    rounded: "{rounded.lg}"
    width: "780px"
  dock-cell:
    textColor: "{colors.fg-100}"
    padding: "16px 24px"
    height: "92px"
---

# Design System: Classight

## Overview

**Creative North Star: "The White Pool"**

The class name is a body of dark pigment dispersed on a white page. The ground is pure white, the marks are near-black cool ink, and one flat coral accent marks the single thing worth doing next. The public face (home, class info, login) is an Experience surface: full-bleed, no page scroll, a particle name the cursor can grab. Console and admin are Operate surfaces in the same material: plain, dense, hairline-structured, never decorated.

The system is strictly two tones plus one accent. Structure comes from 1px low-alpha ink lines, not fills or heavy shadows. The home stage adds a faint hairline column grid that fades toward the edges, a one-line slogan under the name, and a three-cell glass dock as the entrance to the sheet. Motion is exponential ease-out and critically-damped springs; nothing tweens linearly (except the functional spinner and skeleton). The look is modern and minimal, and does not borrow calligraphy, seals, brush strokes, or other motif decoration.

**Key Characteristics:**
- White ground, near-black ink, one coral accent.
- Hairline borders (10% and 24% ink alpha) carry all structure.
- White frosted glass for the info sheet, the home dock, dialogs and toasts only.
- Four-corner bracket is the signature: cursor (leans a few px toward the pointer while snapped), brand mark, keyboard focus on the stage.
- 4px spacing base; 6/10/18px radii; Geist plus Noto Sans SC, tabular numerals for data.

## Colors

Two tones and a single warm flare. Bg is the page, fg is the pigment.

### Primary
- **Coral Flare** (accent): primary action and the "start" entry only; also text selection, caret, and the brand mark's center dot. Hover and press shades and the label ink are in the tokens.

### Neutral
- **Page White** (bg-950): page ground and home stage. **Mist** (bg-900): admin sidebar. **Lifted White** (bg-850): the quiet radial lift behind the name. **bg-800/700/600**: skeletons, option menus, switch tracks, scrollbar thumbs.
- **Near-Black Ink** (fg-100): primary text, default focus ring, bracket strokes, switch on-state. **fg-200/300**: secondary text, labels, slogan, hint. **fg-500**: hints, table heads, section headings, dock labels. **fg-700**: placeholders and scrollbar hover.
- **Hairline** (line) for dividers, table rules and the home column grid; **Strong Hairline** (line-strong) for control borders.

### Status (functional only)
- **Danger** (danger) with a 10% wash; **Success** (success) with a 10% wash. Used for errors, badges, toasts; never decoration. Both are darkened for contrast on white.

### Named Rules
**The One Flare Rule.** Coral appears on the primary action, the "start" entry, the brand mark's center dot, selection and caret. Nothing else, and never as glow or gradient text.
**The Two Tone Rule.** Every other surface is bg or fg at some alpha. Status hues are for state, not emphasis.

## Typography

**Display / Body Font:** Geist Variable (Latin) with Noto Sans SC, PingFang SC, Hiragino Sans GB, Microsoft YaHei, system-ui for CJK.
**Mono:** none; tabular numerals (`tabular-nums`) on tables and `.num` instead.

**Character:** One quiet sans family for both scripts; hierarchy comes from size and weight 500/600, not from a second face.

### Hierarchy
- **Display** (600, 2.25rem, 1.2, -0.02em): console/admin page titles; the home name is rendered as particles.
- **Headline** (600, 1.5rem): sheet and major headings.
- **Title** (600, 1.125rem): dialog titles, empty-state titles, dock values (-0.01em).
- **Body** (400, 0.9375rem, 1.55): default text; prose capped near 42ch in states. The home slogan is body-size or title-size (1.125rem, fg-300, centered, max 560px).
- **Label** (500, 0.8125rem): field labels, table heads, section headings (fg-500, 0.02em tracking), dock labels, buttons small.
- **Caption** (0.75rem): hints, errors, badges.

### Named Rules
**The Sentence Case Rule.** Labels and headings are sentence-case at their natural weight; hierarchy never leans on uppercase, tracking tricks, or small tagged lines above headings.

## Layout

Home is a fixed full-viewport stage (no page scroll, wheel and touch drive progress 0..1). A hairline column grid (96px columns, 55% opacity, radially masked toward the edges) sits behind the cloud. The name sits in the upper third, the slogan directly under it, the three-cell dock in the lower middle (up to 780px wide, bottom offset clamp(110px, 27vh, 260px)); slogan and dock fade out as progress rises. Chrome sits only in corners: top-right login or avatar, bottom-right start, bottom-left language, bottom-center hint; offsets are max(24px, safe-area inset). Below 720px the dock cells shrink (76px, icons and arrows hidden); below 640px viewport height the dock is hidden. Admin is a 248px sticky sidebar plus fluid content at 900px and up, collapsing to a toggled top bar below; console switches at 860px; further breakpoints at 980px, 720px, 560px. Page rhythm: title, 12px sub row, 48px between sections, 16px under section headings. Spacing is a 4px scale (4 to 72). Lists are full-width hairline rows (52px links, 16px vertical session rows), not cards.

## Elevation & Depth

Flat by default; depth is tonal (bg steps) and hairline. The single shadow is for floating glass, and it is a soft offset blur in cool slate, light enough for a white page.

### Shadow Vocabulary
- **Pop** (`0 18px 44px -14px rgba(15,23,42,0.22), 0 2px 6px rgba(15,23,42,0.07)`): glass sheet, dock, dialogs, toasts only.
- **White Glass** (bg rgba(255,255,255,0.5), 26px blur, saturate 1.2, 1px edge rgba(11,18,32,0.12), inset top highlight rgba(255,255,255,0.9)): falls back to a 96% white solid when backdrop-filter is unsupported. Dialog backdrop is rgba(15,23,42,0.32) with 6px blur.

### Named Rules
**The Glass Is Rare Rule.** White glass is reserved for the info sheet, the home dock, dialogs and toasts. Operate surfaces (console, admin) never use it, and nothing else on the home stage becomes a pane.

## Shapes

Soft but restrained: 6px (skeletons), 10px (buttons, inputs, tables, toasts), 18px (dialogs, sheet, dock), pill for badges, circle for avatars and switch. Borders are 1px hairlines; the dock's cells are divided by 1px hairlines, not separate cards. The signature geometry is the bracket: four 6px (mark) or 14px (focus) corner strokes at 1.5px, never a closed box.

## Components

### Buttons
- **Shape:** 10px radius, heights 32/40/48, weight 500, press shifts down 1px.
- **Primary:** coral fill, near-black label; disabled turns to a hairline outline with fg-500 text.
- **Secondary:** 4% ink fill, strong hairline border, border darkens to fg-300 on hover. **Ghost:** transparent, 8% ink wash on hover. **Danger:** danger text and 45% border, wash on hover.
- **Focus:** 2px fg-100 outline, 3px offset (coral on primary).

### Inputs / Fields
- 40px min height, 10px radius, 4% ink fill, strong hairline border; hover border fg-500; focus border becomes fg-100 and fill 7%. Invalid border is danger. Labels fg-300 at 0.8125rem, hints fg-500, errors danger.
- Switch: 38x22 track, fg-100 when on. Checkbox accent is fg-100.

### Badges
- 22px pill, hairline border, fg-300 text; success/danger variants with 10% wash; solid variant white on ink.

### Tables
- Hairline-wrapped, 10px radius, 0.8125rem, fg-500 heads on a 2% wash, hover row 3% wash, tabular numerals.

### Dialogs and Toasts
- White glass, 18px dialog radius, hairline head/foot dividers, enter via 280ms ease-out rise of 10px. Toasts fixed bottom-right, 360px.

### Home Dock
- One glass pane, three equal cells (class info, classmates, timeline), each a bracket snap target and a shortcut into the sheet at that section. Cell: 16px/24px padding, min 92px, a small icon plus fg-500 label above a 600 title-size value (ellipsized, tabular numerals), an arrow bottom-right that nudges 4px on hover; hover washes the cell 4% ink. Cells are separated by 1px hairlines and inherit the pane's outer corners. Values come from the same overview data as the sheet.

### Navigation
- Admin sidebar on bg-900 with a right hairline, 40px rows, 10px radius, 2px gaps; console and home use corner chrome.

### Bracket (signature)
- Pointer-following cursor on the stage: 1.5px fg-100 corners that follow with spring inertia, snap to the name or a dock cell, lean a few px toward the pointer while snapped (a looser spring than the snap), and expand into the sheet rect. The same mark is the brand logo (18px, with a coral center dot) and the keyboard focus on the name.

### Motion
- CSS: ease-out cubic-bezier(0.16,1,0.3,1), ease-in-out (0.65,0,0.35,1), ease-snap (0.2,0.9,0.1,1); durations 140/280/640ms. JS springs in shared/motion: follow, snap, lean, progress, commit. Reduced motion collapses all durations to near zero. Home entry is staged: name, then slogan (900ms delay), then dock (1100ms), then corner chrome (600ms).

## Do's and Don'ts

### Do:
- **Do** build new surfaces from bg grounds, fg text, and hairline rules.
- **Do** spend coral only on the one primary action per view.
- **Do** use tokens (`--bg-*`, `--fg-*`, `--s-*`, `--r-*`, `--ease-*`, `--dur-*`) and named springs; no literal curves.
- **Do** keep every state change reversible and respect reduced motion.
- **Do** use tabular numerals wherever data lives.

### Don't:
- **Don't** add glow halos, gradient text, or a second accent hue.
- **Don't** use glass on console or admin surfaces, or on home elements beyond the sheet and dock.
- **Don't** reach for hero banners, card grids, or scrolling marketing pages on the public face.
- **Don't** add calligraphy, seals, brush strokes or other motif decoration.
- **Don't** use linear tweens for UI motion.
