# Vrolen

Browser-based production-line simulator for industrial engineers and continuous-improvement practitioners. Model multi-line discrete manufacturing — stations, workers, materials, shifts, defects, breakdowns — and simulate locally in your browser via WebAssembly. Visualized as a live isometric factory scene.

> _Model your production line. Press play. Watch the bottleneck._

## Status

Pre-development. Backlog planned and seeded in [Jira VROL](https://opefyre.atlassian.net/jira/software/projects/VROL/boards/34). Active work tracked through sprints.

## Stack

- **Frontend:** React 19 · Vite · TypeScript (strict) · Tailwind v4 · shadcn/ui · Zustand · Zod
- **Visualization:** PixiJS in a Web Worker (OffscreenCanvas) · Kenney.nl isometric sprites
- **Editor:** react-flow (xyflow)
- **Engine:** TypeScript (Phases 0–3) → Rust→WASM (Phase 4+)
- **Backend:** Supabase (Auth · Postgres + RLS · Storage · Edge Functions)
- **Hosting:** Cloudflare Pages
- **AI:** Provider-agnostic with Gemini Flash default; BYO key supported

## Working agreements

All work flows through Jira. See [`vrolen-rules`](../.claude/skills/vrolen-rules/SKILL.md) for the source-of-truth on sprint discipline, the stack, credentials, and skill delegation.

## Local development

To be filled in as Phase 0 scaffolding lands.

## License

TBD.
