---
name: Native export truth
description: The evidence threshold required before a generated audio project may claim a native plugin target.
---

An audio project may claim native exportability only when the export bridge preserves its validated DSP, control semantics, and category-specific performance topology. Reject unsupported or out-of-range metadata rather than silently clamping, substituting, or dropping it.

**Why:** A generic compiling scaffold can produce a valid plugin bundle that is functionally different from the generated browser project. Compilation alone does not prove faithful export.

**How to apply:** For future project kinds and native targets, carry explicit export assets and topology through the contract, validate them at both boundaries, execute behavioral tests, and compile at least one representative generated target. Desktop hosts must accept only versioned native processor adapters, reject enabled unsupported inserts before playback, and defer low-latency parity claims until a real-device workload benchmark is published.