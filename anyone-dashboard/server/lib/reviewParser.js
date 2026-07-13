// ============================================================
// AI 자동 검수 - 프롬프트 조립 + 응답 파싱 (계획서 5장 "검수 구조" 반영)
//
// 검수자(1차): 사실관계·출처·과장표현·AI스러운 문장 체크
// 실제 네트워크 호출은 여기서 하지 않고, 프롬프트 조립과 응답 파싱만 순수 함수로 다룹니다.
// (테스트: scripts/test-review-parser.mjs)
// ============================================================

export function buildReviewSystemPrompt() {
  return `너는 애니원(AnyOne)의 검수자(팩트체커)야. 아래 게시물 초안을 검수해줘.

체크할 것:
1. 사실관계 - 근거 없는 확신에 찬 주장이 있는지
2. 과장 표현 - 과도하게 부풀린 효능/효과 표현이 있는지 (식품이면 "다이어트 효과", "면역력 강화" 등 의약품 수준 표현 여부도 확인)
3. AI스러운 문장 - "~것으로 보입니다", "~라 할 수 있습니다" 같은 AI 특유의 딱딱한 어투가 남아있는지

셋 중 하나라도 문제가 있으면 반려, 전부 문제 없으면 통과로 판단해.

반드시 아래 JSON 형식으로만 응답해 (다른 설명 없이 JSON만):
{"result": "통과 또는 반려", "reasons": ["문제가 있다면 구체적으로, 없으면 빈 배열"], "checks": {"fact_check": "pass 또는 fail", "exaggeration": "pass 또는 fail", "ai_tone": "pass 또는 fail"}}`
}

export function buildReviewUserPrompt({ title, body, channel }) {
  return `채널: ${channel || '미지정'}\n제목: ${title || ''}\n본문:\n${body || ''}`
}

export function buildReviewMessages({ title, body, channel }) {
  return {
    system: buildReviewSystemPrompt(),
    messages: [{ role: 'user', content: buildReviewUserPrompt({ title, body, channel }) }],
  }
}

const VALID_RESULTS = ['통과', '반려']
const VALID_CHECK_VALUES = ['pass', 'fail']

/**
 * Claude의 검수 응답을 파싱합니다. 형식이 이상하면 "파싱 실패"를 안전하게 반려로 처리합니다
 * (검수 결과를 함부로 통과로 추측하지 않는 게 핵심 - 애매하면 반려 쪽으로 fail-safe).
 */
export function parseReviewResponse(text) {
  const fallback = {
    result: '반려',
    reasons: ['AI 검수 응답을 해석하지 못했어요. 사람이 직접 확인해주세요.'],
    checks: { fact_check: 'fail', exaggeration: 'fail', ai_tone: 'fail' },
    parseError: true,
  }

  if (!text || !text.trim()) return fallback

  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return fallback
  }

  if (!VALID_RESULTS.includes(parsed.result)) return fallback

  const checks = parsed.checks || {}
  const normalizedChecks = {
    fact_check: VALID_CHECK_VALUES.includes(checks.fact_check) ? checks.fact_check : 'fail',
    exaggeration: VALID_CHECK_VALUES.includes(checks.exaggeration) ? checks.exaggeration : 'fail',
    ai_tone: VALID_CHECK_VALUES.includes(checks.ai_tone) ? checks.ai_tone : 'fail',
  }

  return {
    result: parsed.result,
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : [],
    checks: normalizedChecks,
    parseError: false,
  }
}
