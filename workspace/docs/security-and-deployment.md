# Security and deployment guide

## Deployment modes

### Hosted SaaS

Use for small teams and public trials. Requires multi-tenant authorization, object-storage isolation, billing/quotas, centralized observability, and strict model-provider controls.

### Private cloud / VPC

Use for enterprise customers with proprietary DSP, unreleased products, or protected media. Provide Terraform or Helm, external Postgres, S3-compatible storage, SSO, secret-manager integration, and audit-log export.

### Offline studio mode

Use for studios that cannot send prompts, plugin code, or audio material to third-party services. Disable cloud providers by default and run local generation/validation paths only.

## Required environment controls

- Set `NODE_ENV=production` for production services.
- Set explicit allowed origins for any browser-facing LLM or proxy surface.
- Keep provider API keys server-side only.
- Use separate databases and artifact buckets for development, staging, and production.
- Rotate API keys and database credentials on a documented schedule.

## Native build isolation

Native builds must run in disposable workers. A production worker should have:

- one job per workspace,
- read-only compiler/toolchain images,
- no cross-tenant shared directories,
- wall-clock and CPU limits,
- network disabled unless explicitly required,
- artifact malware scanning,
- SBOM and provenance generation,
- signing/notarization after approval only.

## Logging and privacy

Logs must not contain raw prompts, generated code, provider credentials, cookies, authorization headers, customer audio, or artifact contents unless an organization explicitly enables a secure diagnostic mode. Store diagnostic payloads with expiration, access logging, and deletion support.

## API authorization pattern

Every durable object request should enforce both identity and organization membership:

1. Authenticate the caller.
2. Resolve organization membership and role.
3. Validate request input with generated Zod/OpenAPI schemas.
4. Scope the database query by `organization_id`.
5. Emit an audit event for state-changing actions.
