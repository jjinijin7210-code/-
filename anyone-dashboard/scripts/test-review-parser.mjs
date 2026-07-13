// reviewParser.js를 Node.js에서 실제로 실행해서 검증.
// 실행: node scripts/test-review-parser.mjs

import assert from 'node:assert/strict'
import { buildReviewSystemPrompt, buildReviewUserPrompt, parseReviewResponse } from '../server/lib/reviewParser.js'

let passed = 0
function check(name, fn) {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (e) {
    console.log(`  ❌ ${name}`)
    console.log(`     -> ${e.message}`)
    process.exitCode = 1
  }
}

console.log('=== 1. 검수 프롬프트에 3가지 체크 항목이 포함되는지 ===')
check('사실관계·과장표현·AI스러운 문장 3가지가 모두 언급됨', () => {
  const prompt = buildReviewSystemPrompt()
  assert.ok(prompt.includes('사실관계'))
  assert.ok(prompt.includes('과장'))
  assert.ok(prompt.includes('AI스러운 문장'))
})
check('식품 과장 효능 표현 체크 문구가 포함됨', () => {
  const prompt = buildReviewSystemPrompt()
  assert.ok(prompt.includes('다이어트 효과') || prompt.includes('면역력'))
})
check('user prompt에 채널/제목/본문이 포함됨', () => {
  const prompt = buildReviewUserPrompt({ title: '제목입니다', body: '본문입니다', channel: '스레드' })
  assert.ok(prompt.includes('제목입니다'))
  assert.ok(prompt.includes('본문입니다'))
  assert.ok(prompt.includes('스레드'))
})

console.log('=== 2. 정상 응답 파싱 ===')
check('통과 응답이 정확히 파싱됨', () => {
  const result = parseReviewResponse(
    '{"result": "통과", "reasons": [], "checks": {"fact_check": "pass", "exaggeration": "pass", "ai_tone": "pass"}}'
  )
  assert.equal(result.result, '통과')
  assert.deepEqual(result.reasons, [])
  assert.equal(result.parseError, false)
})
check('반려 응답과 사유가 정확히 파싱됨', () => {
  const result = parseReviewResponse(
    '{"result": "반려", "reasons": ["과장된 효능 표현 있음"], "checks": {"fact_check": "pass", "exaggeration": "fail", "ai_tone": "pass"}}'
  )
  assert.equal(result.result, '반려')
  assert.deepEqual(result.reasons, ['과장된 효능 표현 있음'])
  assert.equal(result.checks.exaggeration, 'fail')
})
check('```json 코드펜스로 감싸진 응답도 파싱됨', () => {
  const result = parseReviewResponse('```json\n{"result": "통과", "reasons": []}\n```')
  assert.equal(result.result, '통과')
})

console.log('=== 3. 비정상 응답은 안전하게 "반려"로 처리 (fail-safe) ===')
check('빈 응답은 반려 + 파싱실패 표시', () => {
  const result = parseReviewResponse('')
  assert.equal(result.result, '반려')
  assert.equal(result.parseError, true)
})
check('JSON이 아닌 응답도 반려 처리', () => {
  const result = parseReviewResponse('그냥 텍스트')
  assert.equal(result.result, '반려')
  assert.equal(result.parseError, true)
})
check('result 값이 통과/반려가 아니면(예: "보류") 반려로 안전 처리', () => {
  const result = parseReviewResponse('{"result": "보류", "reasons": []}')
  assert.equal(result.result, '반려')
  assert.equal(result.parseError, true)
})
check('checks 필드가 없거나 이상해도 죽지 않고 fail로 채워짐', () => {
  const result = parseReviewResponse('{"result": "통과", "reasons": []}')
  assert.equal(result.checks.fact_check, 'fail')
  assert.equal(result.checks.exaggeration, 'fail')
  assert.equal(result.checks.ai_tone, 'fail')
})

console.log(`\n총 ${passed}개 테스트 통과`)
