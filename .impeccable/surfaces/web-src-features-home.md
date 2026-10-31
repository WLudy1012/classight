---
version: 1
slug: "web-src-features-home"
primary_target: "web/src/features/home"
related_targets: []
---

# Surface brief: Classight public face (home, class info, login)

Mode: Experience (home, class info, login/register). The console and admin are Operate surfaces inside the same material world, plain and dense.

## Audience and task
Classmates, teachers, parents, public visitors. They arrive, play with the name, push into class information, or log in / start the console. Constraints: no page scroll on the homepage, bilingual zh/en, particle name editable by admin, full keyboard/touch/reduced-motion/no-WebGL path.

## Direction contract
THESIS: The class name is a body of ink dispersed in dark water that the cursor can grab; scrolling pushes the frame outward until it becomes the class information sheet. Refuses the category default of a hero banner with a scrolling page and a card grid. Modern, minimal, explicitly not "guofeng": no calligraphy, seals, brush strokes, or Chinese-motif decoration.
OWN-WORLD: White ground (#ffffff, hairline fills down to #c6cfdb) with near-black pigment (#0b1220): the name is a body of dark particles on a white page (user pinned a white theme after the first build). Strictly two tones plus one flat accent, coral-orange (#ff6a3d), used only on the primary action and the "start" entry. No glow halos, no gradient text. Frosted glass is a specific material: white translucent glass with a 1px dark edge and bright top highlight, used for the info sheet, the home dock and dialogs. Type: Geist for Latin, Noto Sans SC for CJK, tabular numerals for data. Four-corner bracket cursor drawn in 1.5px ink strokes; while snapped it leans a few px toward the pointer.
STORY: A visitor sees a dispersed cloud condense into the class name, moves the bracket onto it (it snaps, particles stir around the pointer), scrolls, and the bracket opens into a glass sheet holding the class story, timeline and people; "start" and login are always in reach at the corners.
FIRST VIEWPORT: Full-bleed white scene with a faint hairline column grid. The name in 3D particles sits in the upper third, centered, about 60% of viewport width; the slogan sits just under it; a three-cell glass dock (class info / classmates / timeline, each a snap target and a shortcut into the sheet) sits in the lower middle. Top-right: login ghost button or avatar. Bottom-right: "start" coral button with arrow. Bottom-left: language toggle. Bottom-center: a quiet hint ("move the frame onto the name" at idle, "scroll down to enter the class" once locked).
FORM: Ink-in-water dispersion world (own grounded candidate 5 of 7; seed key eddd5bfd), fused with Ikeda discipline (strict two-tone plus one accent, hairline structure) and Rietveld honesty (every motion reversible, mirrored on scroll back).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Signature interaction
Snap-lock then push: bracket snaps to the 3D name (stage locked, particles still disturbed by cursor), wheel-down advances progress 0..1: bracket expands to the sheet rect, name rises and shrinks, glass sheet resolves. Motion grammar: exponential ease-out and critically-damped springs only; no linear tweens.

## Unresolved
Real class name, real members and timeline (synthetic data in this phase, labelled), deployment.
