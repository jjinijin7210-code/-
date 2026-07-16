// briefing.js를 Node.js에서 실제로 실행해서 검증.
// 실행: node scripts/test-briefing.mjs

import assert from 'node:assert/strict'
import { isSameDay, filterToday, buildBriefingText } from '../src/lib/briefing.js'

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

const TODAY = new Date('2026-07-12T09:00:00+09:00')
const YESTERDAY = new Date('2026-07-11T09:00:00+09:00')

console.log('=== 1. 날짜 비교 ===')
check('같은 날짜면 true', () => {
  assert.equal(isSameDay('2026-07-12T01:00:00Z', '2026-07-12T23:00:00Z'), true)
})
check('다른 날짜면 false', () => {
  assert.equal(isSameDay(TODAY, YESTERDAY), false)
})
check('값이 없으면 false', () => {
  assert.equal(isSameDay(null, TODAY), false)
  assert.equal(isSameDay(TODAY, undefined), false)
})

console.log('=== 2. 오늘 항목만 필터링 ===')
check('created_at이 오늘인 것만 남음', () => {
  const items = [
    { id: 1, created_at: TODAY.toISOString() },
    { id: 2, created_at: YESTERDAY.toISOString() },
    { id: 3, created_at: TODAY.toISOString() },
  ]
  const result = filterToday(items, 'created_at', TODAY)
  assert.deepEqual(result.map((r) => r.id), [1, 3])
})

console.log('=== 3. 브리핑 텍스트 생성 ===')
{
  const drafts = [
    { title: '오늘 등록된 글', created_at: TODAY.toISOString(), published_at: null },
    { title: '오늘 발행된 글', created_at: YESTERDAY.toISOString(), published_at: TODAY.toISOString() },
    { title: '어제 글', created_at: YESTERDAY.toISOString(), published_at: null },
  ]
  const reviews = [
    { check_type: '팩트체크', result: '통과', checked_at: TODAY.toISOString() },
    { check_type: '자연스러움', result: '반려', reason: 'AI스러운 문장 다수', checked_at: TODAY.toISOString() },
    { check_type: '팩트체크', result: '통과', checked_at: YESTERDAY.toISOString() },
  ]
  const benchmarks = [
    { keyword: '겨울 원피스', platform: '블로그', popularity_score: 87, collected_at: TODAY.toISOString() },
    { keyword: '어제 키워드', platform: '스레드', collected_at: YESTERDAY.toISOString() },
  ]

  const text = buildBriefingText({ referenceDate: TODAY, drafts, reviews, benchmarks })

  check('제목에 날짜가 포함됨', () => {
    assert.ok(text.includes('아침 브리핑'))
  })
  check('오늘 등록된 초안 건수가 반영됨', () => {
    assert.ok(text.includes('오늘 새로 등록된 초안: 1건'))
  })
  check('오늘 발행 완료 글 제목이 포함됨', () => {
    assert.ok(text.includes('오늘 발행된 글'))
    assert.ok(!text.includes('어제 글'))
  })
  check('검수 통과/반려 건수가 정확히 집계됨 (오늘 것만)', () => {
    assert.ok(text.includes('통과 1건 / 반려 1건'))
  })
  check('반려 사유가 포함됨', () => {
    assert.ok(text.includes('AI스러운 문장 다수'))
  })
  check('오늘 벤치마킹 키워드만 포함되고 어제 것은 제외됨', () => {
    assert.ok(text.includes('겨울 원피스'))
    assert.ok(!text.includes('어제 키워드'))
  })

  check('오늘 데이터가 전혀 없으면 "없어요" 안내 문구가 나옴', () => {
    const emptyText = buildBriefingText({ referenceDate: TODAY, drafts: [], reviews: [], benchmarks: [] })
    assert.ok(emptyText.includes('없어요'))
  })
}

console.log(`\n총 ${passed}개 테스트 통과`)
