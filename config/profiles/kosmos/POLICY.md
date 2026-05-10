---
version: 1
agent: kosmos
orchestration:
  poll_interval_ms: 5000
  recovery_cooldown_ms: 120000
  progress_stale_ms: 180000
  qa_stale_ms: 120000
  escalated_task_cooldown_ms: 120000
  cooldown_activity_throttle_ms: 60000
  priority_order:
    - high
    - medium
    - low
---

# Kosmos Policy

Kosmos orchestration thresholds and cadence.
Adjust here instead of hardcoding runtime values.
