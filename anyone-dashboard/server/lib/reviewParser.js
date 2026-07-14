// ============================================================
// AI 자동 검수 - 프롬프트 조립 + 응답 파싱 (계획서 5장 "검수 구조" 반영)
//
// 한 번의 AI 호출로 끝내지 않고, 서로 다른 관점의 검수를 3단계로 나눠서 돌린다
// (요청사항: "검수는 2중3중으로"). 셋 중 하나라도 반려면 전체 반려로 처리한다.
//   1차: 팩트체크/과장표현/AI스러운 문장
//   2차(교차검수): 1차와 독립적으로 같은 기준을 다시 검증 (같은 사람이 자기 글 다시 보면 놓치는 것 방지)
//   3차: 20대 초반이 편하게 읽히는 자연스러운 문체인지만 집중적으로 검증
//
// 실제 네트워크 호출은 여기서 하지 않고, 프롬프트 조립과 응답 파싱만 순수 함수로 다룹니다.
// (테스트: scripts/test-review-parser.mjs)
// ============================================================

import { tryParseJsonLoose } from './jsonRepair.js'

export const REVIEW_STAGES = ['1차 검수', '교차 검수', '가독성 검수']

function buildStage1SystemPrompt() {
  return `너는 애니원(AnyOne)의 검수자(팩트체커)야. 아래 게시물 초안을 검수해줘.

체크할 것:
1. 사실관계 - 근거 없는 확신에 찬 주장이 있는지
2. 과장 표현 - 과도하게 부풀린 효능/효과 표현이 있는지 (식품이면 "다이어트 효과", "면역력 강화" 등 의약품 수준 표현 여부도 확인)
3. AI스러운 문장 - "~것으로 보입니다", "~라 할 수 있습니다" 같은 AI 특유의 딱딱한 어투가 남아있는지

셋 중 하나라도 문제가 있으면 반려, 전부 문제 없으면 통과로 판단해.

반드시 아래 JSON 형식으로만 응답해 (다른 설명 없이 JSON만):
{"result": "통과 또는 반려", "reasons": ["문제가 있다면 구체적으로, 없으면 빈 배열"], "checks": {"fact_check": "pass 또는 fail", "exaggeration": "pass 또는 fail", "ai_tone": "pass 또는 fail"}}`
}

function buildCrossReviewSystemPrompt() {
  return `너는 애니원(AnyOne)의 교차 검수자야. 1차 검수자와는 다른 시각으로, 독립적으로 다시 검수해줘
(1차 검수 결과는 알려주지 않을 거야 - 처음 보는 것처럼 새로 확인해).

체크할 것 (1차와 동일한 기준을 놓친 게 없는지 다시 본다):
1. 사실관계 - 근거 없는 확신에 찬 주장이 있는지
2. 과장 표현 - 과도하게 부풀린 효능/효과 표현이 있는지
3. AI스러운 문장 - 딱딱하고 기계적인 어투가 남아있는지

셋 중 하나라도 문제가 있으면 반려, 전부 문제 없으면 통과로 판단해.

반드시 아래 JSON 형식으로만 응답해 (다른 설명 없이 JSON만):
{"result": "통과 또는 반려", "reasons": ["문제가 있다면 구체적으로, 없으면 빈 배열"], "checks": {"fact_check": "pass 또는 fail", "exaggeration": "pass 또는 fail", "ai_tone": "pass 또는 fail"}}`
}

function buildReadabilitySystemPrompt() {
  return `너는 애니원(AnyOne)의 가독성 전담 검수자야. 딱 하나만 집중해서 봐줘:

"20대 초반 독자가 스크롤하다가 읽었을 때, 자연스럽고 편안하게 읽히는가?"

체크할 것:
1. readability - 문장이 너무 길거나 복잡해서 읽다가 지치지 않는지
2. tone_comfort - 딱딱하거나 설명충 같지 않고, 친구가 말해주는 것처럼 편안한지
3. natural_flow - 문단 전개가 자연스럽고 뜬금없이 튀는 부분이 없는지

셋 중 하나라도 문제가 있으면 반려, 전부 자연스러우면 통과로 판단해.

반드시 아래 JSON 형식으로만 응답해 (다른 설명 없이 JSON만):
{"result": "통과 또는 반려", "reasons": ["문제가 있다면 구체적으로, 없으면 빈 배열"], "checks": {"readability": "pass 또는 fail", "tone_comfort": "pass 또는 fail", "natural_flow": "pass 또는 fail"}}`
}

const STAGE_BUILDERS = {
  '1차 검수': buildStage1SystemPrompt,
  '교차 검수': buildCrossReviewSystemPrompt,
  '가독성 검수': buildReadabilitySystemPrompt,
}

// 단계별로 기대하는 체크 항목 - 응답에 없으면 fail-safe로 채워넣을 때 기준이 됨
export const STAGE_CHECK_KEYS = {
  '1차 검수': ['fact_check', 'exaggeration', 'ai_tone'],
  '교차 검수': ['fact_check', 'exaggeration', 'ai_tone'],
  '가독성 검수': ['readability', 'tone_comfort', 'natural_flow'],
}
const DEFAULT_CHECK_KEYS = STAGE_CHECK_KEYS['1차 검수']

export function buildReviewUserPrompt({ title, body, channel }) {
  return `채널: ${channel || '미지정'}\n제목: ${title || ''}\n본문:\n${body || ''}`
}

// 하위 호환용 (기존 테스트/코드에서 1차 검수 프롬프트만 참조하는 경우)
export function buildReviewSystemPrompt() {
  return buildStage1SystemPrompt()
}

export function buildReviewMessages({ title, body, channel, stage = '1차 검수' }) {
  const buildSystem = STAGE_BUILDERS[stage] || buildStage1SystemPrompt
  return {
    system: buildSystem(),
    messages: [{ role: 'user', content: buildReviewUserPrompt({ title, body, channel }) }],
  }
}

const VALID_RESULTS = ['통과', '반려']
const VALID_CHECK_VALUES = ['pass', 'fail']

/**
 * Claude의 검수 응답(한 단계)을 파싱합니다. 형식이 이상하면 "파싱 실패"를 안전하게 반려로 처리합니다
 * (검수 결과를 함부로 통과로 추측하지 않는 게 핵심 - 애매하면 반려 쪽으로 fail-safe).
 * @param {string[]} expectedCheckKeys - 이 단계에서 기대하는 체크 항목들 (응답에 없으면 fail로 채움)
 */
export function parseReviewResponse(text, expectedCheckKeys = DEFAULT_CHECK_KEYS) {
  const fallback = {
    result: '반려',
    reasons: ['AI 검수 응답을 해석하지 못했어요. 사람이 직접 확인해주세요.'],
    checks: Object.fromEntries(expectedCheckKeys.map((k) => [k, 'fail'])),
    parseError: true,
  }

  if (!text || !text.trim()) return fallback

  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

  // 앞뒤 설명 문구나 이스케이프 안 된 줄바꿈 때문에 순수 JSON.parse가 깨지는 경우를 보정
  const parsed = tryParseJsonLoose(cleaned)
  if (!parsed) return fallback

  if (!VALID_RESULTS.includes(parsed.result)) return fallback

  const rawChecks = parsed.checks || {}
  const normalizedChecks = {}
  for (const key of expectedCheckKeys) {
    normalizedChecks[key] = VALID_CHECK_VALUES.includes(rawChecks[key]) ? rawChecks[key] : 'fail'
  }

  return {
    result: parsed.result,
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : [],
    checks: normalizedChecks,
    parseError: false,
  }
}

// 여러 단계 검수 결과를 하나로 합친다 - 하나라도 반려면 전체 반려 (fail-safe)
export function combineStageResults(stageResults) {
  const overallResult = stageResults.every((s) => s.result.result === '통과') ? '통과' : '반려'
  const reasons = stageResults.flatMap((s) =>
    s.result.reasons.map((r) => `[${s.stage}] ${r}`),
  )
  const checks = Object.assign({}, ...stageResults.map((s) => s.result.checks))

  return {
    result: overallResult,
    reasons,
    checks,
    stages: stageResults.map((s) => ({ stage: s.stage, ...s.result })),
  }
}
