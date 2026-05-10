---
version: 1
agent: wedge
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
handoff:
  max_requeue_before_pause: 8
  max_closure_comment_chars: 3500
---

# Wedge Policy

QA approval signal parsing and handoff formatting limits.
Use this file to tune Wedge approval behavior declaratively.
