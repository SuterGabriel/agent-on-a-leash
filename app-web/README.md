# HackZurich 2026 — Agent on a Leash (app)

> **In this repo.** This is Kim's `app-web` from [agent-card-handover](https://github.com/kimbadertscher/agent-card-handover), copied as is. The handover pack (concept, backend hookup spec, contract, Viseca API notes) is in [`handover/`](handover/). The backend in `packages/backend` serves the app's contract under `/v4/app/*`: from the repo root run `npm run api` (port 8787), then here `cp .env.example .env.local && npm run dev`. Details: [`docs/backend-hookup.md`](docs/backend-hookup.md) and the root README.

React 19 · Vite · Tailwind v4 · **Untitled UI React v8 PRO**, kept in sync with the Untitled UI PRO v8 Figma file.

```bash
npm install
npm run dev            # http://localhost:5173
                       # living style guide: http://localhost:5173/design-system
npm run build
```

- **How design ↔ code sync works, setup, and gotchas:** [`design-system/README.md`](design-system/README.md)
- **Rules for Claude Code and the slash commands:** [`CLAUDE.md`](CLAUDE.md) · `.claude/commands/`
- **Figma variable → Tailwind class lookup:** [`design-system/tokens/TOKENS.md`](design-system/tokens/TOKENS.md)

| Slash command (Claude Code) | Use it when |
|---|---|
| `/figma-to-code <figma link>` | a screen or section is ready in Figma |
| `/sync-tokens` | variables changed in Figma (colors, radius, fonts) |
| `/restyle <direction>` | you want a new visual style across Figma and code |
| `/code-to-figma <component>` | a developer added or changed a component |
| `/check-sync` | before a demo or handoff, to confirm nothing has drifted |
