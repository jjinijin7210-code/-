// juneCharacter.js를 Node.js에서 실제로 실행해서 검증.
// 실행: node scripts/test-june-character.mjs

import assert from 'node:assert/strict'
import {
  JUNE_VIEW_KINDS,
  JUNE_TEXT_FIELDS,
  getEmptyJuneCharacter,
  getActiveVersion,
  setActiveVersion,
  buildJuneSummary,
} from '../src/lib/juneCharacter.js'

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

console.log('=== 1. 기본 데이터 구조 ===')
check('앞/측/뒷면 3종 뷰가 정의됨', () => {
  assert.deepEqual(JUNE_VIEW_KINDS.map((v) => v.key), ['front', 'side', 'back'])
})
check('요청하신 텍스트 속성 필드(얼굴/헤어/의상/표정/포즈/색상/금지요소/기준프롬프트)가 모두 있음', () => {
  const keys = JUNE_TEXT_FIELDS.map((f) => f.key)
  assert.deepEqual(keys, ['face', 'hair', 'outfit', 'expression', 'pose', 'color', 'forbidden_elements', 'base_prompt'])
})
check('getEmptyJuneCharacter는 version/is_active/views + 8개 속성 필드를 가짐', () => {
  const empty = getEmptyJuneCharacter()
  assert.equal(empty.version, '')
  assert.equal(empty.is_active, false)
  assert.deepEqual(empty.views, [])
  for (const f of JUNE_TEXT_FIELDS) assert.equal(empty[f.key], '')
})

console.log('=== 2. 버전 활성화 (항상 1개만 활성) ===')
{
  let versions = [
    { id: 'v1', version: 'v1.0', is_active: true },
    { id: 'v2', version: 'v2.0', is_active: false },
    { id: 'v3', version: 'v3.0', is_active: false },
  ]

  check('처음엔 v1이 활성 버전', () => {
    assert.equal(getActiveVersion(versions).id, 'v1')
  })

  check('v3을 활성화하면 v1은 자동으로 비활성화되고 활성은 v3 하나뿐', () => {
    versions = setActiveVersion(versions, 'v3')
    const actives = versions.filter((v) => v.is_active)
    assert.equal(actives.length, 1)
    assert.equal(actives[0].id, 'v3')
  })

  check('활성 버전이 없으면 getActiveVersion은 null', () => {
    const noneActive = versions.map((v) => ({ ...v, is_active: false }))
    assert.equal(getActiveVersion(noneActive), null)
  })
}

console.log('=== 3. 요약 문구 생성 ===')
check('얼굴/헤어/의상/표정/포즈/색상을 이어붙여서 요약 생성', () => {
  const character = { face: '동그란 얼굴', hair: '단발', outfit: '노란 원피스', expression: '미소', pose: '', color: '파스텔톤' }
  const summary = buildJuneSummary(character)
  assert.equal(summary, '동그란 얼굴 · 단발 · 노란 원피스 · 미소 · 파스텔톤')
})

console.log(`\n총 ${passed}개 테스트 통과`)
