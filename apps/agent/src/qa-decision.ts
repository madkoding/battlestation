export interface QaDecision {
  decision: 'approve' | 'reject'
  summary: string
  blockers: string[]
  evidence_refs: string[]
  confidence: number | null
  source: 'structured' | 'repaired' | 'fallback'
}

type JsonObject = Record<string, unknown>

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonObject
}

export function parseJsonObjectLoose(raw: string): JsonObject | null {
  const text = String(raw || '').trim()
  if (!text) return null
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)
  const candidate = String(fenced?.[1] || text)

  const parseCandidate = (value: string): JsonObject | null => {
    try {
      return asObject(JSON.parse(value))
    } catch {
      // noop
    }
    return null
  }

  const direct = parseCandidate(candidate)
  if (direct) return direct

  const firstObject = candidate.match(/\{[\s\S]*\}/)
  if (firstObject) {
    return parseCandidate(firstObject[0])
  }

  return null
}

export function normalizeQaDecisionObject(payload: JsonObject, source: QaDecision['source']): QaDecision | null {
  const rawDecision = String(payload.decision || payload.verdict || payload.status || '').toLowerCase().trim()
  const decision = rawDecision === 'approve' || rawDecision === 'approved'
    ? 'approve'
    : (rawDecision === 'reject' || rawDecision === 'rejected' || rawDecision === 'rework' || rawDecision === 'failed'
      ? 'reject'
      : '')
  if (!decision) return null

  const summary = String(payload.summary || payload.reason || payload.rationale || '').trim()
  const blockers = Array.isArray(payload.blockers)
    ? payload.blockers.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  const evidenceRefs = Array.isArray(payload.evidence_refs)
    ? payload.evidence_refs.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  const confidenceRaw = Number(payload.confidence)
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : null

  return {
    decision,
    summary: summary || (decision === 'approve' ? 'QA checks passed with available evidence.' : 'QA evidence indicates unresolved issues.'),
    blockers,
    evidence_refs: evidenceRefs,
    confidence,
    source,
  }
}

export async function resolveQaDecision(params: {
  policyAgent: string
  inputBudget: number
  rawResponse: string
  compactText: (text: string, maxTokens: number) => string
  callLLM: (prompt: string) => Promise<string>
}): Promise<QaDecision> {
  const { policyAgent, inputBudget, rawResponse, compactText, callLLM } = params
  const structured = normalizeQaDecisionObject(parseJsonObjectLoose(rawResponse) || {}, 'structured')
  if (structured) return structured

  const repairPrompt = `You are a JSON normalizer for QA outcomes.

Convert the following QA review text into strict JSON with this shape:
{
  "decision": "approve|reject",
  "summary": "string",
  "blockers": ["string"],
  "evidence_refs": ["string"],
  "confidence": 0.0
}

Rules:
- Return JSON only. No markdown.
- Use decision=reject if the text is inconclusive.
- Keep summary concise.

Text:
${compactText(rawResponse, Math.max(1600, Math.floor(inputBudget * 0.45)))}
`

  try {
    const repairedRaw = await callLLM(compactText(repairPrompt, inputBudget))
    const repaired = normalizeQaDecisionObject(parseJsonObjectLoose(repairedRaw) || {}, 'repaired')
    if (repaired) return repaired
  } catch {
    // fallback below
  }

  return {
    decision: 'reject',
    summary: 'QA decision could not be parsed as structured JSON; blocking approval until structured evidence is produced.',
    blockers: [
      'QA reviewer output was not parseable structured JSON',
      `Expected decision schema from policy agent '${policyAgent || 'unknown'}'`,
    ],
    evidence_refs: [],
    confidence: null,
    source: 'fallback',
  }
}

export function formatQaDecisionForPrompt(decision: QaDecision): string {
  const blockers = decision.blockers.length
    ? decision.blockers.map((item) => `- ${item}`).join('\n')
    : '- none'
  const evidenceRefs = decision.evidence_refs.length
    ? decision.evidence_refs.map((item) => `- ${item}`).join('\n')
    : '- none'

  return [
    `Decision: ${decision.decision}`,
    `Summary: ${decision.summary}`,
    `Confidence: ${decision.confidence == null ? 'n/a' : decision.confidence}`,
    `Source: ${decision.source}`,
    '',
    'Blockers:',
    blockers,
    '',
    'Evidence refs:',
    evidenceRefs,
  ].join('\n')
}
