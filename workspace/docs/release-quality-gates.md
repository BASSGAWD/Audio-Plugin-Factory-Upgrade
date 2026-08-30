# Release quality gates

A generated plugin version is not releasable until it has machine-verifiable evidence.

## Required checks

- TypeScript typecheck for workspace packages.
- Unit and integration tests for generation, schema validation, and persistence.
- DSP benchmark suite for stability, clipping, DC offset, denormals, CPU cost, latency, and parameter audibility.
- Browser smoke test for web playback and UI control binding.
- Native build validation for each supported target.
- Artifact provenance with source version, generation job, benchmark report, dependency versions, and build environment.

## Benchmark report minimum fields

- `plugin_version_id`
- `status`
- `score`
- `latency_ms`
- `cpu_percent`
- `peak_dbfs`
- `dc_offset`
- `findings`
- `evidence`
- `created_at`

## Release decision

Only versions with passing benchmark status, approved review state, signed artifacts, and complete provenance may be marked as released.
