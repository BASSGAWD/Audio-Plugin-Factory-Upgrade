---
name: Hosted sync proof
description: The evidence standard for cross-device cloud synchronization.
---

Cross-device sync is not proven by domain tests with fake transports. Its acceptance check must traverse the same hosted route, authentication boundary, and persistent object store used by real browser sessions.

**Why:** Local state-machine coverage can pass while preview routing or hosted storage authentication prevents every real transfer.

**How to apply:** Require two independent signed-in browser contexts plus observable persistent upload and download evidence before accepting resume, conflict, account-switch, or quota behavior.