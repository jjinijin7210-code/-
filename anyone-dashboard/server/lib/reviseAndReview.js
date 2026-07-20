// ============================================================
// 반려된 초안을 반려 사유에 맞춰 AI가 스스로 고치고, 통과하거나 최대 시도 횟수에
// 닿을 때까지 반복 검수한다. 자동 파이프라인(benchmark.js)과 수동 "AI가 알아서
// 고쳐서 재검수" 버튼(review.js) 둘 다 이 로직을 공유한다.
// ============================================================

import { callClaude, callClaudeWithParseRetry } from './anthropicClient.js'
import { buildReviseMessages, parseDraftResponse } from './promptBuilder.js'
import {
  buildReviewMessages,
  parseReviewResponse,
  combineStageResults,
  REVIEW_STAGES,
  STAGE_CHECK_KEYS,
} from './reviewParser.js'

// 무한 재시도로 API 비용이 새는 걸 막기 위한 상한
const MAX_RETRIES = 2

export async function runReviewStages({ title, body, channel }) {
  const stageResults = []
  for (const stage of REVIEW_STAGES) {
    const { system, messages } = buildReviewMessages({ title, body, channel, stage })
    // 2026-07-20: 파싱 실패 시 그냥 반려로 넘기지 않고 최대 2번 재시도 - draft-generation과
    // 동일한 문제(가끔 JSON이 깨짐)가 검수 단계에도 있었는데 여긴 재시도가 빠져 있었음
    const result = await callClaudeWithParseRetry({
      system,
      messages,
      maxTokens: 1024,
      parse: (text) => parseReviewResponse(text, STAGE_CHECK_KEYS[stage]),
    })
    stageResults.push({ stage, result })
  }
  return combineStageResults(stageResults)
}

/**
 * @param {object} params
 * @param {string} params.title
 * @param {string} params.body
 * @param {string} params.channel
 * @param {object} params.initialReview - 이미 반려로 나온 최초 검수 결과 (combineStageResults 형태)
 * @param {number} [params.maxRetries]
 * @returns {Promise<{title:string, body:string, review:object, attempts:number}>}
 */
export async function reviseUntilPassOrGiveUp({ title, body, channel, initialReview, maxRetries = MAX_RETRIES }) {
  let currentTitle = title
  let currentBody = body
  let review = initialReview
  let attempts = 0

  while (review.result !== '통과' && attempts < maxRetries) {
    attempts++
    const { system, messages } = buildReviseMessages({
      channel,
      title: currentTitle,
      body: currentBody,
      reasons: review.reasons,
    })
    // draft.js/benchmark.js의 최초 생성 호출과 마찬가지로 1024로는 카테고리에 따라
    // JSON이 중간에 잘리는 문제가 있었음 (반려→재작성 경로에서 실측 확인, 2026-07-18)
    const text = await callClaude({ system, messages, maxTokens: 2000 })
    const revised = parseDraftResponse(text)
    currentTitle = revised.title
    currentBody = revised.body
    review = await runReviewStages({ title: currentTitle, body: currentBody, channel })
  }

  return { title: currentTitle, body: currentBody, review, attempts }
}
