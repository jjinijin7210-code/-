// validation.js를 Node.js에서 실제로 실행해서 검증.
// 실행: node scripts/test-validation.mjs

import assert from 'node:assert/strict'
import { findMissingRequired, isDuplicate } from '../src/lib/validation.js'

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

console.log('=== 1. 필수 항목 검증 ===')
{
  const requiredFields = [
    { key: 'title', label: '제목' },
    { key: 'assignee', label: '담당자' },
  ]

  check('전부 채워져 있으면 빈 배열', () => {
    const missing = findMissingRequired({ title: '글', assignee: '홍길동' }, requiredFields)
    assert.deepEqual(missing, [])
  })
  check('비어있는 필드의 라벨이 반환됨', () => {
    const missing = findMissingRequired({ title: '', assignee: '홍길동' }, requiredFields)
    assert.deepEqual(missing, ['제목'])
  })
  check('공백만 있는 값도 비어있는 것으로 취급', () => {
    const missing = findMissingRequired({ title: '   ', assignee: '홍길동' }, requiredFields)
    assert.deepEqual(missing, ['제목'])
  })
  check('undefined/null도 비어있는 것으로 취급하고, 여러 개 비어있으면 전부 반환', () => {
    const missing = findMissingRequired({}, requiredFields)
    assert.deepEqual(missing, ['제목', '담당자'])
  })
}

console.log('=== 2. 중복 요청 감지 ===')
{
  const list = [
    { id: 'a', trigger_keyword: '핑크' },
    { id: 'b', trigger_keyword: '블루' },
  ]

  check('이미 있는 값이면 true', () => {
    assert.equal(isDuplicate(list, 'trigger_keyword', '핑크'), true)
  })
  check('대소문자/공백이 달라도 같은 값으로 인식', () => {
    assert.equal(isDuplicate(list, 'trigger_keyword', '  핑크  '), true)
  })
  check('없는 값이면 false', () => {
    assert.equal(isDuplicate(list, 'trigger_keyword', '그린'), false)
  })
  check('excludeId로 자기 자신은 중복으로 치지 않음 (수정 중인 경우)', () => {
    assert.equal(isDuplicate(list, 'trigger_keyword', '핑크', 'a'), false)
  })
  check('빈 값은 중복 검사 대상 아님', () => {
    assert.equal(isDuplicate(list, 'trigger_keyword', ''), false)
  })
}

console.log(`\n총 ${passed}개 테스트 통과`)
