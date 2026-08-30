# Company readiness plan

## Target customer profile

OrangeJUCE should first target professional audio teams that need a private, auditable plugin-prototyping workspace. This is easier to make trustworthy than an unrestricted public generator because access can be organization-scoped, model usage can be governed, and generated artifacts can be reviewed before release.

## Non-negotiable launch requirements

### Product and workflow

- Project dashboard with organization-owned projects.
- Saved plugin versions with immutable generation inputs and outputs.
- Review states: draft, benchmarked, approved, release candidate, released, archived.
- Export records for Faust, JUCE/C++, VST3 bundles, and any future AU/AAX target.
- Human-readable benchmark reports attached to every releasable version.

### Security

- SSO/OIDC/SAML-ready identity model.
- Role-based access control for owner, admin, engineer, reviewer, and viewer roles.
- Tenant checks at the database query boundary and the API handler boundary.
- Secret redaction in logs and audit trails.
- Model-provider allowlists and per-organization quotas.
- SSRF-protected outbound network proxying only where explicitly needed.
- Sandboxed native build execution with no customer-to-customer filesystem sharing.

### Compliance and legal

- Customer data processing terms.
- Model-provider data-use policy.
- Generated-code ownership terms.
- License inventory for generated scaffolds and native SDK dependencies.
- Brand/trade-dress guardrails for prompts referencing commercial products.
- Retention/deletion policy for prompts, artifacts, uploaded assets, and logs.

### Operations

- Staging and production environments.
- Health and readiness endpoints.
- Structured JSON logs with request IDs.
- Metrics for generation latency, provider errors, build failures, benchmark failures, and artifact downloads.
- Backup/restore procedures for Postgres and artifact storage.
- Incident response runbook.

## Milestones

1. **Foundation** — root documentation, OpenAPI workflow contracts, Drizzle schema, and deployment/security documentation.
2. **Multi-tenant beta** — org-scoped projects, versioned plugins, audit events, and benchmark report persistence.
3. **Controlled exports** — artifact storage, native build sandboxing, release manifests, and manual approval gates.
4. **Enterprise pilot** — SSO, quota controls, private deployment docs, observability dashboards, and legal/compliance package.
5. **Commercial launch** — billing, support runbooks, reference deployments, signed native artifacts, and customer onboarding.
