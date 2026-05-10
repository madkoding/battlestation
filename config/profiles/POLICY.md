---
version: 1
agent: global
classification:
  frontend_task_pattern: \bfrontend\b|\bux\b|\breact\b|\bvite\b|\bnext\b|\btailwind\b|\bcss\b|\bhtml\b|\bcomponent(s)?\b|\blayout\b|\bresponsive\b|\bdashboard\b|\bmodal\b|\bkanban\b|\bscreenshot(s)?\b|\bplaywright\b|\buser interface\b|\bui shell\b|\bnavigation\b
  documentation_task_pattern: release|deployment|deploy|documentation|docs|runbook|handoff|contribution
delivery_gate:
  require_code_delta: true
  require_tests_for_non_documentation: true
  skip_placeholder_test_script: true
  placeholder_test_script_pattern: no test specified
  require_frontend_qa_evidence: true
  blocked_comment_marker: "## Delivery Gate Blocked"
  escalation_comment_marker: "## Delivery Escalation Required"
context:
  window_tokens: 128000
  input_budget_ratio: 0.72
handoff:
  max_retry_before_block: 3
  max_requeue_before_pause: 8
  max_closure_comment_chars: 3500
planning:
  max_commands: 4
  max_checks: 2
  max_structured_ops: 8
  max_effective_commands: 8
qa:
  approval_keywords:
    - approved
    - looks good
    - passes
    - lgtm
  auth_error_initial_backoff_ms: 120000
  auth_error_max_backoff_ms: 600000
  auth_error_pause_comment_marker: "## QA Paused (Infra)"
review:
  qa_rejection_pattern: reject|cannot approve|failed|return to development
  qa_issue_hint_pattern: required|next action|blocking|root cause|deliverables|port|playwright|screenshot|diff|changed files|commit
loop:
  idle_sleep_ms: 5000
  error_sleep_ms: 5000
  escalation_sleep_ms: 20000
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
  playwright_install_command: npx playwright install chromium
settings:
  tuning_presets:
    strict:
      kosmos: { temperature: 0.15, top_p: 0.85, max_tokens: 16384 }
      vicks: { temperature: 0.2, top_p: 0.9, max_tokens: 24576 }
      wedge: { temperature: 0.1, top_p: 0.8, max_tokens: 16384 }
    balanced:
      kosmos: { temperature: 0.22, top_p: 0.9, max_tokens: 16384 }
      vicks: { temperature: 0.3, top_p: 0.92, max_tokens: 32768 }
      wedge: { temperature: 0.18, top_p: 0.88, max_tokens: 24576 }
    exploratory:
      kosmos: { temperature: 0.32, top_p: 0.95, max_tokens: 24576 }
      vicks: { temperature: 0.45, top_p: 0.96, max_tokens: 49152 }
      wedge: { temperature: 0.25, top_p: 0.92, max_tokens: 32768 }
---

# Runtime Policy

Global runtime behavior for orchestration, delivery gates, and QA evidence.
Role-specific policies can override any field in this document.
