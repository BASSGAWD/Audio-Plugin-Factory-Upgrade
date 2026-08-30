---
name: Generated plugin UI benchmark
description: The confirmed visual-quality direction for plugin interfaces produced by the factory.
---

Generated plugin interfaces should meet or exceed the demonstrated workbench faceplate quality: clear parameter hierarchy, tactile controls, intentional spacing, credible audio-software materials, and immediate visual feedback.

**Why:** The user explicitly confirmed that the demo plugin UI looks substantially better than the factory's existing generated interfaces. The improvement must carry into generated plugin output, not remain limited to the surrounding factory workspace.

**How to apply:** When implementing the production UI pipeline or evaluating generated faceplates, use the demonstrated plugin preview as the baseline. Reject generic dark panels, undifferentiated control grids, weak hierarchy, and controls without polished interaction states.

The renderer-neutral UI contract must be authoritative in every shipping path: Web layout, native JUCE parameter declarations, widget selection, bounds, hierarchy, accessibility, and visual styles must all consume the same validated records.

**Why:** A contract that is merely serialized or exposed as metadata can pass structural tests while the actual Web and native renderers continue using unrelated layouts. Renderer consumption and semantic agreement must be tested directly.

**How to apply:** Require complete control/hierarchy correspondence at boundaries, derive native parameters and widgets from one normalized descriptor, and keep adversarial plus per-widget parity tests as release gates.

The semantic section and control-role vocabulary is a cross-renderer contract: Web and JUCE should preserve the same grouping, hierarchy, coordinates, and control intent instead of independently flattening parameters into generic grids.

**Why:** Renderer-specific substitutions made generated native interfaces diverge from the approved browser faceplate even when both consumed the same parameter list.

**How to apply:** Layout every semantic section as a coherent region, derive artboard bounds from the final control rectangles (including explicit sizes), and require generic or spatially interleaved panels to fail visual quality checks.

Generated visual identities must be deterministic without becoming repetitive: identical specifications keep the same identity, while family, attributes, and stable plugin identity produce visibly different materials, controls, meters, and motion. Preserve user-supplied plugin names; generated identity labels stay secondary.

**Why:** The requested variety is only credible when recipe tokens change real Web and JUCE rendering. Metadata-only tokens, renderer-specific overrides, or automatic replacement of explicit names create false parity and unpredictable output.

**How to apply:** Resolve effective visual choices once in the shared contract, map every advertised token to distinct behavior in both renderers, reject malformed persisted tokens, and honor reduced motion by disabling decorative scheduling rather than only freezing its output.