// lunaRequestFields.js를 Node.js에서 실제로 실행해서 검증.
// 실행: node scripts/test-luna-request-fields.mjs

import assert from 'node:assert/strict'
import {
  REQUEST_TYPES,
  REQUEST_STATUS_FLOW,
  IMAGE_FIELDS,
  VIDEO_FIELDS,
  getFieldsForType,
  getEmptyDetails,
} from '../src/data/lunaRequestFields.js'

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

console.log('=== 1. 상태 흐름 ===')
check('요청 상태 흐름이 요청하신 11단계 그대로 (순서 포함)', () => {
  assert.deepEqual(REQUEST_STATUS_FLOW, [
    '요청 작성', '전달', '접수', '담당자 배정', '제작 중', '내부 QA',
    '교차 검수', '결과 수령', '진희 승인', '애니원 등록', '사용 완료',
  ])
})
check('요청 종류는 이미지/영상/기타 3가지', () => {
  assert.deepEqual(REQUEST_TYPES, ['이미지', '영상', '기타'])
})

console.log('=== 2. 이미지 요청 필드 (17개, 요청하신 항목 전부 포함) ===')
check('이미지 필드 개수가 17개', () => {
  assert.equal(IMAGE_FIELDS.length, 17)
})
check('요청하신 이미지 필드 라벨이 모두 존재함', () => {
  const labels = IMAGE_FIELDS.map((f) => f.label)
  const required = [
    '채널', '사용 목적', '타깃', '핵심 메시지', '이미지 종류', '비율', '스타일',
    '캐릭터', '배경', '의상', '표정', '이미지 문구', '금지 요소', '참고 이미지 (링크/설명)',
    '장수', '우선순위', '브랜드',
  ]
  for (const label of required) {
    assert.ok(labels.includes(label), `"${label}"이 이미지 필드에 없음`)
  }
})

console.log('=== 3. 영상 요청 필드 (12개, 요청하신 항목 전부 포함) ===')
check('영상 필드 개수가 12개', () => {
  assert.equal(VIDEO_FIELDS.length, 12)
})
check('요청하신 영상 필드 라벨이 모두 존재함', () => {
  const labels = VIDEO_FIELDS.map((f) => f.label)
  const required = [
    '곡명', '총길이', '장면 수', '장면 길이', '영상 AI', '비율', '카메라 움직임',
    '립싱크 여부', '자막 여부', '시작 장면', '마지막 장면', '참고 이미지',
  ]
  for (const label of required) {
    assert.ok(labels.includes(label), `"${label}"이 영상 필드에 없음`)
  }
})
check('립싱크/자막 여부는 체크박스 타입', () => {
  const lipsync = VIDEO_FIELDS.find((f) => f.key === 'lipsync')
  const subtitle = VIDEO_FIELDS.find((f) => f.key === 'subtitle')
  assert.equal(lipsync.type, 'checkbox')
  assert.equal(subtitle.type, 'checkbox')
})

console.log('=== 4. 요청 종류별 필드/기본값 매핑 ===')
check('getFieldsForType("이미지")는 IMAGE_FIELDS와 동일', () => {
  assert.equal(getFieldsForType('이미지'), IMAGE_FIELDS)
})
check('getFieldsForType("영상")는 VIDEO_FIELDS와 동일', () => {
  assert.equal(getFieldsForType('영상'), VIDEO_FIELDS)
})
check('getFieldsForType("기타")는 빈 배열', () => {
  assert.deepEqual(getFieldsForType('기타'), [])
})
check('getEmptyDetails("이미지")는 17개 키를 모두 빈 문자열로 초기화', () => {
  const details = getEmptyDetails('이미지')
  assert.equal(Object.keys(details).length, 17)
  assert.equal(details.channel, '')
  assert.equal(details.quantity, '')
})
check('getEmptyDetails("영상")는 체크박스 필드만 false, 나머지는 빈 문자열', () => {
  const details = getEmptyDetails('영상')
  assert.equal(details.lipsync, false)
  assert.equal(details.subtitle, false)
  assert.equal(details.song_title, '')
})
check('getEmptyDetails("기타")는 빈 객체', () => {
  assert.deepEqual(getEmptyDetails('기타'), {})
})

console.log(`\n총 ${passed}개 테스트 통과`)
