// promptBuilder.js를 Node.js에서 실제로 실행해서 검증.
// 실행: node scripts/test-prompt-builder.mjs

import assert from 'node:assert/strict'
import {
  buildDraftSystemPrompt,
  buildDraftUserPrompt,
  buildDraftMessages,
  parseDraftResponse,
} from '../server/lib/promptBuilder.js'

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

console.log('=== 1. system prompt에 톤 원칙이 실제로 포함되는지 ===')
check('공통 원칙(20대 초반 타겟, AI스러운 어미 금지)이 모든 채널에 포함됨', () => {
  const prompt = buildDraftSystemPrompt('스레드')
  assert.ok(prompt.includes('20대 초반'))
  assert.ok(prompt.includes('것으로 보입니다'))
})
check('스레드는 캐주얼 톤 지시가 포함됨', () => {
  const prompt = buildDraftSystemPrompt('스레드')
  assert.ok(prompt.includes('캐주얼'))
})
check('인스타/틱톡에는 해외 트렌드 재구성 원칙(원문 번역 금지)이 반드시 포함됨', () => {
  const prompt = buildDraftSystemPrompt('인스타/틱톡')
  assert.ok(prompt.includes('그대로 번역하지'))
  assert.ok(prompt.includes('완전히 새로운 문장'))
})
check('스레드에는 현지화 원칙 문구가 들어가지 않음 (해당 채널 아님)', () => {
  const prompt = buildDraftSystemPrompt('스레드')
  assert.ok(!prompt.includes('그대로 번역하지'))
})
check('인스타/틱톡(영어)는 영어로만 쓰라는 지시 + 현지화 원칙 포함', () => {
  const prompt = buildDraftSystemPrompt('인스타/틱톡(영어)')
  assert.ok(prompt.includes('반드시 영어로만 작성해'))
  assert.ok(prompt.includes('그대로 번역하지'))
})
check('인스타/틱톡(일본어)는 일본어로만 쓰라는 지시 + 현지화 원칙 포함', () => {
  const prompt = buildDraftSystemPrompt('인스타/틱톡(일본어)')
  assert.ok(prompt.includes('반드시 일본어로만 작성해'))
  assert.ok(prompt.includes('그대로 번역하지'))
})
check('응답 형식을 JSON으로 강제하는 지시가 포함됨', () => {
  const prompt = buildDraftSystemPrompt('스레드')
  assert.ok(prompt.includes('JSON'))
})

console.log('=== 2. user prompt 조립 ===')
check('채널/주제가 포함됨', () => {
  const prompt = buildDraftUserPrompt({ channel: '스레드', topic: '겨울 원피스 꿀템' })
  assert.ok(prompt.includes('스레드'))
  assert.ok(prompt.includes('겨울 원피스 꿀템'))
})
check('referenceNote가 있으면 "그대로 번역 금지" 안내와 함께 포함됨', () => {
  const prompt = buildDraftUserPrompt({
    channel: '인스타/틱톡',
    topic: '겨울 원피스',
    referenceNote: '따뜻한 색감과 레이어드 룩이 인기',
  })
  assert.ok(prompt.includes('따뜻한 색감과 레이어드 룩이 인기'))
  assert.ok(prompt.includes('번역 금지'))
})
check('referenceNote가 없으면 관련 문구가 아예 없음', () => {
  const prompt = buildDraftUserPrompt({ channel: '스레드', topic: '겨울 원피스' })
  assert.ok(!prompt.includes('참고한 해외 트렌드'))
})

console.log('=== 3. 메시지 조립 ===')
check('buildDraftMessages는 system과 messages 배열을 함께 반환', () => {
  const { system, messages } = buildDraftMessages({ channel: '스레드', topic: '겨울 원피스' })
  assert.ok(system.length > 0)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].role, 'user')
})

console.log('=== 4. 응답 파싱 ===')
check('깨끗한 JSON은 그대로 파싱됨', () => {
  const result = parseDraftResponse('{"title": "제목입니다", "body": "본문입니다", "hashtags": "#태그1 #태그2"}')
  assert.equal(result.title, '제목입니다')
  assert.equal(result.body, '본문입니다')
  assert.equal(result.hashtags, '#태그1 #태그2')
})
check('```json 코드펜스로 감싸진 응답도 파싱됨', () => {
  const text = '```json\n{"title": "제목", "body": "본문"}\n```'
  const result = parseDraftResponse(text)
  assert.equal(result.title, '제목')
  assert.equal(result.hashtags, '')
})
check('빈 응답은 명확한 에러', () => {
  assert.throws(() => parseDraftResponse(''), /빈 응답/)
})
check('JSON이 아닌 응답은 명확한 에러', () => {
  assert.throws(() => parseDraftResponse('그냥 텍스트입니다'), /해석하지 못했어요/)
})
check('title/body가 없는 JSON은 명확한 에러', () => {
  assert.throws(() => parseDraftResponse('{"hashtags": "#태그"}'), /제목 또는 본문/)
})

console.log(`\n총 ${passed}개 테스트 통과`)
