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
  applyJuneReferenceToRequest,
} from '../src/lib/juneCharacter.js'
import { getEmptyDetails } from '../src/data/lunaRequestFields.js'

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

console.log('=== 4. 요청서에 June 공식 기준 자동 반영 ===')
{
  const juneV1 = {
    id: 'v1',
    version: 'v1.0',
    is_active: true,
    face: '동그란 얼굴',
    hair: '단발머리',
    outfit: '노란 원피스',
    expression: '밝은 미소',
    pose: '',
    color: '파스텔톤',
    forbidden_elements: '실존 인물과 닮은 얼굴 금지',
    base_prompt: 'a cute chibi character named June, round face, yellow dress',
  }

  check('활성 버전이 없으면 에러', () => {
    let threw = false
    try {
      applyJuneReferenceToRequest({ details: getEmptyDetails('이미지') }, null)
    } catch (e) {
      threw = true
      assert.ok(e.message.includes('활성화된 June'))
    }
    assert.ok(threw)
  })

  check('이미지 요청에 적용하면 details.character에 요약이 채워짐', () => {
    const request = { request_type: '이미지', details: getEmptyDetails('이미지') }
    const updated = applyJuneReferenceToRequest(request, juneV1)
    assert.ok(updated.details.character.includes('단발머리'))
    assert.ok(updated.details.character.includes('노란 원피스'))
  })

  check('기존 character 값이 있으면 지우지 않고 뒤에 이어붙임', () => {
    const request = { request_type: '이미지', details: { ...getEmptyDetails('이미지'), character: '기존 설명' } }
    const updated = applyJuneReferenceToRequest(request, juneV1)
    assert.ok(updated.details.character.startsWith('기존 설명'))
    assert.ok(updated.details.character.includes('June:'))
  })

  check('금지 요소가 기존 값과 중복 없이 합쳐짐', () => {
    const request = { request_type: '이미지', details: getEmptyDetails('이미지') }
    const updated = applyJuneReferenceToRequest(request, juneV1)
    assert.ok(updated.details.forbidden_elements.includes('실존 인물과 닮은 얼굴 금지'))

    // 두 번 적용해도 문구가 중복되지 않아야 함
    const updatedAgain = applyJuneReferenceToRequest(updated, juneV1)
    const occurrences = updatedAgain.details.forbidden_elements.split('실존 인물과 닮은 얼굴 금지').length - 1
    assert.equal(occurrences, 1)
  })

  check('june_reference 스냅샷이 버전/기준프롬프트/적용시각과 함께 저장됨', () => {
    const request = { request_type: '이미지', details: getEmptyDetails('이미지') }
    const updated = applyJuneReferenceToRequest(request, juneV1)
    assert.equal(updated.june_reference.version, 'v1.0')
    assert.equal(updated.june_reference.base_prompt, juneV1.base_prompt)
    assert.ok(updated.june_reference.applied_at)
  })

  check('영상 요청처럼 details에 character 필드가 없으면 details는 그대로, june_reference만 추가됨', () => {
    const request = { request_type: '영상', details: getEmptyDetails('영상') }
    const updated = applyJuneReferenceToRequest(request, juneV1)
    assert.ok(!('character' in updated.details))
    assert.equal(updated.june_reference.version, 'v1.0')
  })

  check('원본 request 객체는 변경되지 않음 (불변성 유지)', () => {
    const request = { request_type: '이미지', details: getEmptyDetails('이미지') }
    const before = JSON.stringify(request)
    applyJuneReferenceToRequest(request, juneV1)
    assert.equal(JSON.stringify(request), before)
  })
}

console.log(`\n총 ${passed}개 테스트 통과`)
