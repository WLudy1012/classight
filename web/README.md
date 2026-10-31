# Classight web

React + TypeScript + Vite frontend. The default mock API runs without a backend; `VITE_API_MODE=http` connects to the real server.

## Run

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # unit tests (mock API contract, motion)
pnpm build        # typecheck + production build
```

Demo accounts (mock only): `admin / Admin123!` (SuperAdmin), `teacher / Teacher123!` (Admin), `student / Student123!` (Member). Invite code for registration: `CLASS2026`.
Mock data lives in `localStorage` (`classight.mock.db.v1`); clear it to reset.

## Talk to the real backend

Copy `.env.example` to `.env.local` and set `VITE_API_MODE=http`. Requests go to `VITE_API_BASE` (default `/api/v1`, proxied to `localhost:5080` by `vite.config.ts`). No feature code changes: only the transport in `src/shared/api` is swapped.

## Structure

```
src/
  app/                 routes, page shell
  shared/
    api/               types (mirror the contract), client (401 → refresh → retry), endpoints, mock/
    ui/                buttons, fields, dialog, toasts, tables, icons, page rhythm
    motion/            springs + easing tokens (the only place motion numbers live)
    i18n/              zh / en dictionaries, error-code → message mapping
  features/
    home/              stage (state machine), cursor (bracket + magnets), scene (GPGPU particles)
    class-info/        the class story (sheet on home, full page at /class)
    auth/              store, guards, login/register, account menu
    console/           user console ("start")
    class-center/      plugin registration, navigation and routes
    queue/             class meetings and courseware
    timetable/         timetable plugin
    setup/             first-run setup
    admin/             shell + registry; pages are modules in admin/modules/
```

Class-center plugins register their routes and optional home entry in `class-center/plugins/`. Management presentation and configuration are registered separately in `admin/plugin-config/`. See [the plugin guide](../docs/class-center-plugins.md) for the server-side state, dependency and authorization rules.

## Home page

- `?quality=high|medium|low|static` pins the particle tier (QA, or an escape hatch for odd GPUs). Without it the tier comes from the site setting, capped by device hints, and drops automatically if frames run slow.
- Stage flow: `intro → idle → locked → transitioning → info`. Wheel only advances while the bracket is locked on the name; touch uses swipe; keyboard uses Tab to the name, Enter / ↓ to open, Esc / ↑ to close.
- No WebGL2, float render targets or `?quality=static` gives a static name with the same flow.
- `data-magnet` on any element makes the bracket snap to it (`data-magnet-radius`, `-priority`, `-pad` tune it).

## Replace before launch

All class content (names, motto, intro, timeline) is **synthetic demo data** in `src/shared/api/mock/db.ts`. The real content comes from the backend / the admin back office.
