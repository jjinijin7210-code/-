// buildVideoMetadata()(youtubeUploadClient.js)를 네트워크 없이 검증.
// 실행: node scripts/test-youtube-upload-client.mjs

import assert from 'node:assert/strict'
import { buildVideoMetadata } from '../server/lib/youtubeUploadClient.js'

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

console.log('=== 유튜브 업로드 메타데이터 조립 ===')

check('기본값은 privacyStatus=public, categoryId=22(People & Blogs)', () => {
  const m = buildVideoMetadata({ title: '제목' })
  assert.equal(m.status.privacyStatus, 'public')
  assert.equal(m.snippet.categoryId, '22')
})

check('제목이 100자를 넘으면 잘림 (유튜브 제목 길이 제한)', () => {
  const longTitle = '가'.repeat(150)
  const m = buildVideoMetadata({ title: longTitle })
  assert.equal(m.snippet.title.length, 100)
})

check('태그가 30개를 넘으면 30개까지만 사용', () => {
  const tags = Array.from({ length: 50 }, (_, i) => `tag${i}`)
  const m = buildVideoMetadata({ title: '제목', tags })
  assert.equal(m.snippet.tags.length, 30)
})

check('description/tags가 없으면 빈 값으로 채워짐 (에러 안 남)', () => {
  const m = buildVideoMetadata({ title: '제목' })
  assert.equal(m.snippet.description, '')
  assert.deepEqual(m.snippet.tags, [])
})

check('privacyStatus를 지정하면 그대로 반영됨', () => {
  const m = buildVideoMetadata({ title: '제목', privacyStatus: 'unlisted' })
  assert.equal(m.status.privacyStatus, 'unlisted')
})

check('selfDeclaredMadeForKids는 항상 false로 고정', () => {
  const m = buildVideoMetadata({ title: '제목' })
  assert.equal(m.status.selfDeclaredMadeForKids, false)
})

console.log(`\n총 ${passed}개 테스트 통과`)
