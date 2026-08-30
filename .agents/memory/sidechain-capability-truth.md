---
name: Sidechain capability truth
description: How to decide whether generated plugins may advertise external sidechain support.
---

Never infer sidechain support from prompt wording or a lexical `inputKey` reference alone. Require a differential audio probe showing that changing only the auxiliary signal measurably changes output.

**Why:** Comments, dead reads, and substitute export DSP can all look sidechain-aware while producing no key-dependent behavior.

**How to apply:** Keep capability separate from live connection state, require successful engine consumption before showing activity, and reject an export when no faithful port exists rather than substituting a generic ducker.