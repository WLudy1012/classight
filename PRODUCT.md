# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
User-decided (PLAN.md): React + TypeScript frontend (Vite), three.js for the homepage. Backend is .NET 11 and is out of scope for this phase: the frontend is built against a mock API that follows `docs/api-contract.md`.

## Users
Classmates (primary, log in and use the console), plus teachers and parents (log in with other roles) and public visitors who only see the public class information. Used on desktop first (mouse + wheel), with a degraded but complete touch/mobile path.

## Product Purpose
Classight is a long-lived class website: a homepage that is purely an interactive entrance (no scrolling page), a class information page, a user console ("start"), login, and a site administration back office. Success: the homepage feels like an object worth exploring, and every function remains reachable by keyboard, touch and reduced-motion users.

## Positioning
The class name itself is a 3D particle object the cursor can grab; scrolling "pushes into" the class information. A generic class-site template cannot copy that mechanism.

## Operating Context
Homepage has no vertical scroll: wheel input drives a stage transition. Top-right is login button or user avatar; bottom-right is the "start" entry to the user console. Custom cursor is a four-corner square bracket with inertia that snaps to nearby elements, including the 3D class name.

## Capabilities and Constraints
- Homepage: three.js scene; class name modeled in 3D and split into particles with physics and random motion at the top of the page; cursor can disturb particles; while the cursor is snapped to the name, wheel-down enlarges the bracket, moves the name up and reveals the class information page. Glass-morphism cards, non-linear animation.
- Admin back office (2D, conventional) with: site settings, class info editing, users/roles/permissions, invite codes, audit log, system status.
- Interface languages: Chinese and English (bilingual from the first release).
- Placeholder class name: "Classight" (to be replaced by the real class name through site settings).
- Contracts: `docs/api-contract.md` defines every endpoint; frontend uses a mock layer until the backend exists.
- Undecided: real class name, real members/timeline content, deployment target.

## Brand Commitments
Product name "Classight". The brief pins: 3D particle class name, four-corner inertial snapping cursor, glass-morphism cards, non-linear motion, no-scroll homepage.

## Evidence on Hand
No real class content, photos, member names or logos exist. All data in this phase is synthetic demonstration data and must be labelled as replaceable; do not fabricate factual claims about a real class.

## Product Principles
1. The homepage is an entrance, not a page: every interaction either reveals or routes.
2. Nothing is gated behind the spectacle: keyboard, touch, reduced-motion and no-WebGL users reach the same destinations.
3. Built to live for years: features are modular, contract-driven and replaceable.
4. The back office is plain and fast; the expressiveness belongs to the public face.

## Accessibility & Inclusion
Real class name kept in the DOM as text; visible focus states; honors `prefers-reduced-motion`; wheel-driven transitions have button/keyboard equivalents; contrast meets WCAG AA on glass surfaces.
