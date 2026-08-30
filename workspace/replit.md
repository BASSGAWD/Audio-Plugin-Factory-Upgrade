# OrangeJUCE Enterprise Audio Plugin Factory

OrangeJUCE helps audio teams turn natural-language plugin briefs into versioned DSP/UI contracts, benchmark reports, and exportable Faust/JUCE/native artifacts with a company-ready API and persistence foundation.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (set `PORT`, typically 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string for DB-backed packages
- Required env: `PORT` — API/mockup preview runtime port where applicable; Vite preview packages default to 5173 for plain builds

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 with Pino request logging
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild for API bundles, Vite for web artifacts

## Where things live

- `README.md` — product overview and company-readiness checklist
- `docs/company-readiness.md` — roadmap from prototype to enterprise pilot
- `docs/security-and-deployment.md` — deployment modes, privacy, and native-build isolation guidance
- `docs/release-quality-gates.md` — benchmark/release evidence requirements
- `lib/api-spec/openapi.yaml` — source-of-truth public API contract
- `lib/db/src/schema/index.ts` — source-of-truth PostgreSQL domain schema
- `artifacts/api-server` — API runtime boundary
- `artifacts/orangejuce-ui` — design system/browser shell
- `imported/autonomous-audio-plugin-factory` — current feature prototype and DSP/native-build test bed

## Architecture decisions

- Keep OpenAPI as the external contract and regenerate API/Zod clients after contract edits.
- Model organizations explicitly so every durable object can be tenant-scoped by `organization_id`.
- Treat plugin versions as immutable release candidates; approvals, benchmarks, and artifacts attach to versions rather than mutable plugin rows.
- Keep native build execution out of the main API process for production; production workers must be disposable and tenant-isolated.
- Use generated artifacts as outputs of auditable jobs, never as untracked files served from arbitrary paths.

## Product

OrangeJUCE is aimed at professional audio teams that need a private, auditable plugin-prototyping workspace: generate ideas quickly, review code and UI contracts, measure DSP quality, approve versions, and export artifacts with provenance.

## User preferences

- The user wants the project improved enough for company adoption and prefers pragmatic, sweeping improvements over narrow documentation-only advice.

## Gotchas

- Run `pnpm --filter @workspace/api-spec run codegen` after editing `lib/api-spec/openapi.yaml`.
- Run `pnpm run typecheck` before committing; this catches generated API/Zod drift and workspace type regressions.
- `pnpm run build` requires generated clients to be current and now supports plain local builds without manually setting Vite-only `PORT`/`BASE_PATH`.
- Do not route production LLM calls through ad hoc endpoints; consolidate them behind server-managed provider policy, origin checks, quotas, and audit logging.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
