# OrangeJUCE Enterprise Audio Plugin Factory

OrangeJUCE is a company-ready foundation for designing, validating, and exporting audio plugins from natural-language briefs. The repository combines a TypeScript workspace, an API-first service boundary, generated clients, a PostgreSQL/Drizzle persistence layer, and the imported Autonomous Audio Plugin Factory prototype that already demonstrates offline generation, DSP quality gates, and JUCE/Faust export paths.

## Product promise

Teams can describe an effect, instrument, or hybrid audio tool, review the generated DSP and UI contract, run repeatable quality checks, collaborate on revisions, and export versioned build artifacts. The product is intentionally honest about capability boundaries: generated work must be measured, versioned, reviewed, and approved before it is treated as releasable software.

## Company-readiness pillars

1. **API-first contracts** — every durable workflow is described in `lib/api-spec/openapi.yaml` so web clients, SDKs, and CI integrations can rely on stable endpoints.
2. **Persistent project model** — organizations, memberships, projects, plugin versions, generation jobs, build artifacts, benchmark reports, audit events, and usage records live in the Drizzle schema.
3. **Security by default** — production deployments must use authenticated, tenant-scoped APIs, redact secrets from logs, isolate generated artifacts, and route model calls through server-managed providers.
4. **Measured audio quality** — plugin versions are not release candidates until benchmark reports show DSP stability, latency, CPU cost, parameter audibility, clipping/DC safety, and artifact provenance.
5. **Deployment flexibility** — the target operating modes are hosted SaaS, private-cloud/VPC, and offline/local studio workflows.

## Repository map

- `artifacts/api-server/` — Express 5 API service with structured logging and the `/api` route boundary.
- `artifacts/orangejuce-ui/` — design-system preview shell and generated UI components.
- `imported/autonomous-audio-plugin-factory/` — current feature prototype for audio-plugin generation, offline recipes, quality gates, native build scaffolding, and tests.
- `lib/api-spec/` — OpenAPI source of truth for public API contracts.
- `lib/api-zod/` and `lib/api-client-react/` — generated validation/client packages derived from OpenAPI.
- `lib/db/` — PostgreSQL/Drizzle schema and database client.
- `docs/` — operating, security, deployment, and product-readiness guidance.

## Run & operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port supplied by `PORT`).
- `pnpm run typecheck` — full TypeScript typecheck across workspace packages.
- `pnpm run build` — typecheck and build all packages.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas after OpenAPI edits.
- `pnpm --filter @workspace/db run push` — push DB schema changes in development.

Required environment:

- `DATABASE_URL` — PostgreSQL connection string for packages that instantiate the DB client.
- `PORT` — required by `@workspace/api-server` at runtime.

## Production readiness checklist

Before a company runs OrangeJUCE with customer data, require all of the following:

- Authenticated organization membership checks on every project, plugin, job, artifact, and report endpoint.
- Tenant-isolated object storage for generated exports and uploaded audio/material.
- Server-managed LLM gateway with provider allowlists, prompt/output retention policy, redaction, quotas, and audit trails.
- Sandboxed native-build workers with artifact signing/notarization, SBOM generation, malware scanning, and reproducible build metadata.
- CI gates for typecheck, unit tests, OpenAPI code generation drift, DB migration checks, dependency audit, and DSP benchmark contracts.
- Observability: structured logs, request IDs, traces, metrics, queue depth, provider health, build-worker health, and incident runbooks.

## Honest limits

This pass creates product, API, schema, and documentation foundations. It does not magically complete enterprise auth, cloud build isolation, billing, signing, or compliance certification. Those are now explicit tracked requirements instead of implicit gaps.
