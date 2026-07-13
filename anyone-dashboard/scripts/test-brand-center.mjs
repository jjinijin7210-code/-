// brandCenter.js를 Node.js에서 실제로 실행해서 검증.
// 실행: node scripts/test-brand-center.mjs

import assert from 'node:assert/strict'
import {
  DEFAULT_BRAND_NAMES,
  BRAND_TEXT_FIELDS,
  getEmptyBrand,
  getDefaultBrandSeeds,
  ASSET_CATEGORIES,
  COPYRIGHT_STATUS_OPTIONS,
  APPROVAL_STATUS_OPTIONS,
  getEmptyAsset,
} from '../src/data/brandCenter.js'

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

console.log('=== 1. 기본 브랜드 5개 ===')
check('요청하신 5개 브랜드 이름이 정확히 일치', () => {
  assert.deepEqual(DEFAULT_BRAND_NAMES, ['AnyOne', 'Luna Creative Studio', 'June', '트롯충전소', '제나 스튜디오'])
})
check('getDefaultBrandSeeds()는 5개의 브랜드 레코드를 생성하고 이름이 각각 채워져 있음', () => {
  const seeds = getDefaultBrandSeeds()
  assert.equal(seeds.length, 5)
  assert.equal(seeds[0].name, 'AnyOne')
  assert.equal(seeds[2].name, 'June')
  assert.equal(seeds[4].name, '제나 스튜디오')
})
check('브랜드 텍스트 필드(색상/폰트/말투/이미지스타일/금지표현/대표캐릭터/기본해시태그) 7개 모두 존재', () => {
  const labels = BRAND_TEXT_FIELDS.map((f) => f.label)
  assert.deepEqual(labels, ['색상', '폰트', '말투', '이미지 스타일', '금지 표현', '대표 캐릭터', '기본 해시태그'])
})
check('getEmptyBrand는 logo 배열과 7개 텍스트 필드를 빈 값으로 가짐', () => {
  const empty = getEmptyBrand('테스트브랜드')
  assert.equal(empty.name, '테스트브랜드')
  assert.deepEqual(empty.logo, [])
  for (const f of BRAND_TEXT_FIELDS) assert.equal(empty[f.key], '')
})

console.log('=== 2. 에셋 분류 10종 ===')
check('요청하신 10개 분류가 순서까지 정확히 일치', () => {
  assert.deepEqual(ASSET_CATEGORIES, [
    '이미지', '썸네일', '로고', '배너', '캐릭터', '영상', '음원', '프롬프트', '문서', '게시물 완성본',
  ])
})
check('저작권 상태 / 승인 상태 옵션이 정의되어 있음', () => {
  assert.deepEqual(COPYRIGHT_STATUS_OPTIONS, ['자체 제작', '라이선스 구매', '무료 소스', '출처 확인 필요'])
  assert.deepEqual(APPROVAL_STATUS_OPTIONS, ['대기', '승인', '반려'])
})

console.log('=== 3. 빈 에셋 레코드 ===')
check('getEmptyAsset()는 요청하신 7개 메타 항목(브랜드/제작자/제작일/저작권상태/승인상태/버전/연결게시물)을 포함', () => {
  const empty = getEmptyAsset()
  assert.ok('brand' in empty)
  assert.ok('creator' in empty)
  assert.ok('created_date' in empty)
  assert.ok('copyright_status' in empty)
  assert.ok('approval_status' in empty)
  assert.ok('version' in empty)
  assert.ok('linked_post_id' in empty)
  assert.deepEqual(empty.files, [])
})
check('getEmptyAsset()의 기본 브랜드/분류/저작권/승인 상태는 각 목록의 첫 번째 값', () => {
  const empty = getEmptyAsset()
  assert.equal(empty.brand, DEFAULT_BRAND_NAMES[0])
  assert.equal(empty.category, ASSET_CATEGORIES[0])
  assert.equal(empty.copyright_status, COPYRIGHT_STATUS_OPTIONS[0])
  assert.equal(empty.approval_status, APPROVAL_STATUS_OPTIONS[0])
})

console.log(`\n총 ${passed}개 테스트 통과`)
