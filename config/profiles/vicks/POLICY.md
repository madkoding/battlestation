---
version: 1
agent: vicks
delivery_gate:
  require_code_delta: true
  require_tests_for_non_documentation: true
  skip_placeholder_test_script: true
  placeholder_test_script_pattern: no test specified
  require_frontend_qa_evidence: true
  blocked_comment_marker: "## Delivery Gate Blocked"
  escalation_comment_marker: "## Delivery Escalation Required"
handoff:
  max_retry_before_block: 3
  max_requeue_before_pause: 8
  max_closure_comment_chars: 3500
planning:
  max_commands: 4
  max_checks: 2
  max_structured_ops: 8
  max_effective_commands: 8
review:
  qa_rejection_pattern: reject|cannot approve|failed|return to development
  qa_issue_hint_pattern: required|next action|blocking|root cause|deliverables|port|playwright|screenshot|diff|changed files|commit
loop:
  idle_sleep_ms: 5000
  error_sleep_ms: 5000
  escalation_sleep_ms: 20000
runtime_bootstrap:
  node_dev_dependencies:
    - vitest
    - typescript
    - "@types/node"
    - "@playwright/test"
    - playwright
  frontend_extra_dev_dependencies:
    - vite
  ensure_scripts:
    test: vitest run
    typecheck: tsc --noEmit
    frontend_dev: vite --host 127.0.0.1 --port 5173
---

# Vicks Policy

Developer delivery gate requirements and action-plan limits.
Use this file to tune Vicks behavior without code changes.
