// contentPreview.js를 Node.js에서 실제로 실행해서 검증.
// 실행: node scripts/test-content-preview.mjs

import assert from 'node:assert/strict'
import {
  PREVIEW_PLATFORMS,
  parseHashtags,
  truncate,
  isValidUrl,
  appendRevision,
  getPreviewModel,
  getCategoryForChannel,
  isAiDraftChannel,
  isLocalizationChannel,
  isBloggerChannel,
} from '../src/lib/contentPreview.js'

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

console.log('=== 1. 채널 목록 (요청하신 5종 + 인스타/틱톡 언어별 현지화 2종) ===')
check('네이버 블로그 2종(인테리어/생활, 푸드) + 구글 Blogger + 스레드 + 인스타/틱톡(한/영/일)', () => {
  assert.deepEqual(PREVIEW_PLATFORMS, [
    '블로그(네이버)-인테리어/생활',
    '블로그(네이버)-푸드',
    '블로그(구글 Blogger)',
    '스레드',
    '인스타/틱톡',
    '인스타/틱톡(영어)',
    '인스타/틱톡(일본어)',
  ])
})

check('인스타/틱톡 언어별 채널도 AI 초안 생성 + 현지화 원칙 대상', () => {
  assert.equal(isAiDraftChannel('인스타/틱톡(영어)'), true)
  assert.equal(isAiDraftChannel('인스타/틱톡(일본어)'), true)
  assert.equal(isLocalizationChannel('인스타/틱톡(영어)'), true)
  assert.equal(isLocalizationChannel('인스타/틱톡(일본어)'), true)
})

console.log('=== 2. 채널별 분류 헬퍼 ===')
check('푸드 블로그만 카테고리가 "푸드쇼핑"이고 나머지는 "인테리어/생활용품"', () => {
  assert.equal(getCategoryForChannel('블로그(네이버)-푸드'), '푸드쇼핑')
  assert.equal(getCategoryForChannel('블로그(네이버)-인테리어/생활'), '인테리어/생활용품')
  assert.equal(getCategoryForChannel('스레드'), '인테리어/생활용품')
})
check('AI 초안 생성 버튼은 스레드·인스타/틱톡에서만 true', () => {
  assert.equal(isAiDraftChannel('스레드'), true)
  assert.equal(isAiDraftChannel('인스타/틱톡'), true)
  assert.equal(isAiDraftChannel('블로그(구글 Blogger)'), false)
  assert.equal(isAiDraftChannel('블로그(네이버)-푸드'), false)
})
check('해외 트렌드 재구성 원칙은 인스타/틱톡에서만 적용', () => {
  assert.equal(isLocalizationChannel('인스타/틱톡'), true)
  assert.equal(isLocalizationChannel('스레드'), false)
})
check('구글 Blogger 발행 대상 채널 판별', () => {
  assert.equal(isBloggerChannel('블로그(구글 Blogger)'), true)
  assert.equal(isBloggerChannel('블로그(네이버)-푸드'), false)
})

console.log('=== 3. 해시태그 파싱 ===')
check('쉼표/공백/줄바꿈이 섞여도 정확히 분리됨', () => {
  const result = parseHashtags('맛집, 인테리어\n꿀템   추천')
  assert.deepEqual(result, ['#맛집', '#인테리어', '#꿀템', '#추천'])
})
check('#이 이미 붙어있으면 중복으로 붙이지 않음', () => {
  const result = parseHashtags('#맛집 인테리어')
  assert.deepEqual(result, ['#맛집', '#인테리어'])
})
check('중복 태그는 제거됨', () => {
  const result = parseHashtags('맛집 맛집 #맛집')
  assert.deepEqual(result, ['#맛집'])
})
check('빈 문자열/undefined는 빈 배열', () => {
  assert.deepEqual(parseHashtags(''), [])
  assert.deepEqual(parseHashtags(undefined), [])
})

console.log('=== 4. 본문 자르기(truncate) ===')
check('길이 제한보다 짧으면 그대로 반환', () => {
  assert.equal(truncate('짧은 글', 100), '짧은 글')
})
check('길이 제한보다 길면 잘리고 ...이 붙음', () => {
  const long = 'a'.repeat(200)
  const result = truncate(long, 50)
  assert.equal(result.length, 53) // 50자 + '...'
  assert.ok(result.endsWith('...'))
})

console.log('=== 5. URL 형식 검증 ===')
check('빈 값은 아직 안 채운 것으로 보고 통과시킴', () => {
  assert.equal(isValidUrl(''), true)
  assert.equal(isValidUrl(undefined), true)
})
check('http/https로 시작하는 값은 통과', () => {
  assert.equal(isValidUrl('https://blog.naver.com/abc'), true)
  assert.equal(isValidUrl('http://example.com'), true)
})
check('형식이 아닌 값은 실패', () => {
  assert.equal(isValidUrl('그냥텍스트'), false)
  assert.equal(isValidUrl('ftp://example.com'), false)
})

console.log('=== 6. 수정 이력 추가 ===')
check('메모가 있으면 이력에 추가되고 시각이 기록됨', () => {
  const history = appendRevision([], '오탈자 수정', '작성자')
  assert.equal(history.length, 1)
  assert.equal(history[0].note, '오탈자 수정')
  assert.equal(history[0].editor, '작성자')
  assert.ok(history[0].edited_at)
})
check('메모가 비어있으면(공백만 있어도) 이력이 추가되지 않음', () => {
  const history = appendRevision([{ note: '기존기록', edited_at: 'x' }], '   ')
  assert.equal(history.length, 1)
})
check('기존 이력 배열을 변경하지 않음 (불변성)', () => {
  const original = [{ note: 'a', edited_at: 'x' }]
  const result = appendRevision(original, 'b')
  assert.equal(original.length, 1)
  assert.equal(result.length, 2)
})

console.log('=== 7. 채널별 미리보기 데이터 생성 ===')
{
  const draft = {
    title: '겨울 원피스 꿀템 추천',
    body: '가'.repeat(500),
    hashtags: '겨울코디 원피스 꿀템',
    images: [{ id: 'img1', data_url: 'data:image/png;base64,abc' }],
  }

  check('네이버 블로그(인테리어/생활)는 본문을 400자까지 보여주고 해시태그는 인라인 아님', () => {
    const model = getPreviewModel(draft, '블로그(네이버)-인테리어/생활')
    assert.equal(model.bodyPreview.length, 403) // 400 + '...'
    assert.equal(model.showHashtagsInline, false)
  })

  check('구글 Blogger도 블로그 계열과 동일하게 article 형태로 보여줌', () => {
    const model = getPreviewModel(draft, '블로그(구글 Blogger)')
    assert.equal(model.aspect, 'article')
  })

  check('인스타/틱톡은 본문을 100자까지만 자르고 세로형(vertical) 비율', () => {
    const model = getPreviewModel(draft, '인스타/틱톡')
    assert.equal(model.bodyPreview.length, 103)
    assert.equal(model.aspect, 'vertical')
  })

  check('첫 번째 이미지가 firstImage로 전달됨', () => {
    const model = getPreviewModel(draft, '인스타/틱톡')
    assert.equal(model.firstImage.id, 'img1')
  })

  check('이미지가 없으면 firstImage는 null', () => {
    const model = getPreviewModel({ ...draft, images: [] }, '인스타/틱톡')
    assert.equal(model.firstImage, null)
  })

  check('해시태그가 파싱되어 배열로 포함됨', () => {
    const model = getPreviewModel(draft, '스레드')
    assert.deepEqual(model.hashtags, ['#겨울코디', '#원피스', '#꿀템'])
  })
}

console.log(`\n총 ${passed}개 테스트 통과`)
