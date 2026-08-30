---
name: Adaptive project discovery
description: How ORANGEJUCE should handle users who want to build audio software but do not yet know the details.
---

Treat an underspecified request as a discovery state. Determine which missing
decisions materially affect the generated software, then ask targeted creative
or functional questions before composing the capability graph. Do not silently
substitute a generic DAW or demand a complete specification up front.

**Why:** Musicians may arrive with only a feeling, problem, or broad goal. The
system should help them discover what they want while ensuring their answers
change the resulting runtime behavior.

**How to apply:** Ask one high-value question at a time, choose creative
questions for sound and workflow direction and functional questions for
inputs, outputs, interaction, constraints, and environment. Show assumptions,
stop asking once the remaining uncertainty is safe to resolve automatically,
and preserve answers as explicit requirements and acceptance tests.