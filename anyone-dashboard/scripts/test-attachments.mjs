// attachments.js 로직을 Node.js의 표준 File/Blob API로 실제 실행해서 검증.
// 실행: node scripts/test-attachments.mjs

import assert from 'node:assert/strict'
import {
  ATTACHMENT_KINDS,
  MAX_ATTACHMENT_SIZE,
  validateFile,
  fileToAttachment,
  hasAttachmentOfKind,
  canCheckEvidence,
} from '../src/lib/attachments.js'

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

async function checkAsync(name, fn) {
  try {
    await fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (e) {
    console.log(`  ❌ ${name}`)
    console.log(`     -> ${e.message}`)
    process.exitCode = 1
  }
}

console.log('=== 1. 첨부 종류 목록 ===')
check('5가지 증거 종류가 요청하신 그대로임', () => {
  const keys = ATTACHMENT_KINDS.map((k) => k.key)
  assert.deepEqual(keys, ['screenshot', 'test_log', 'error_screen', 'work_file', 'before_after'])
})

console.log('=== 2. 파일 크기 검증 ===')
check('제한 크기보다 작은 파일은 통과', () => {
  const smallFile = new File([new Uint8Array(1000)], 'small.png', { type: 'image/png' })
  const res = validateFile(smallFile)
  assert.equal(res.ok, true)
})
check('제한 크기보다 큰 파일은 거부', () => {
  const bigFile = new File([new Uint8Array(MAX_ATTACHMENT_SIZE + 1)], 'big.png', { type: 'image/png' })
  const res = validateFile(bigFile)
  assert.equal(res.ok, false)
  assert.ok(res.error.includes('너무 커요'))
})

console.log('=== 3. 실제 File 객체를 첨부 레코드로 변환 (실행 화면 이미지 시뮬레이션) ===')
await checkAsync('PNG 이미지 파일을 첨부하면 data_url로 정확히 변환됨', async () => {
  const original = 'PNG-IMAGE-BYTES-테스트'
  const bytes = new TextEncoder().encode(original)
  const file = new File([bytes], 'screenshot.png', { type: 'image/png' })

  const attachment = await fileToAttachment(file, 'screenshot', '홈 화면 정상 렌더링 확인')
  assert.equal(attachment.kind, 'screenshot')
  assert.equal(attachment.filename, 'screenshot.png')
  assert.equal(attachment.mime_type, 'image/png')
  assert.equal(attachment.size, bytes.length)
  assert.ok(attachment.data_url.startsWith('data:image/png;base64,'))
  assert.ok(attachment.id)
  assert.ok(attachment.created_at)

  // 변환한 base64를 다시 디코딩해서 원본과 같은지 확인 (실제로 내용이 보존되는지가 핵심)
  const base64Part = attachment.data_url.split(',')[1]
  const decoded = Buffer.from(base64Part, 'base64').toString('utf-8')
  assert.equal(decoded, original)
})

await checkAsync('너무 큰 파일을 첨부하려 하면 에러가 발생하고 저장되지 않음', async () => {
  const bigFile = new File([new Uint8Array(MAX_ATTACHMENT_SIZE + 100)], 'huge.log', { type: 'text/plain' })
  let threw = false
  try {
    await fileToAttachment(bigFile, 'test_log')
  } catch (e) {
    threw = true
    assert.ok(e.message.includes('너무 커요'))
  }
  assert.ok(threw, '큰 파일은 반드시 에러를 던져야 함')
})

console.log('=== 4. 체크박스 게이팅 (첨부 없이는 체크 불가) ===')
check('첨부가 하나도 없으면 canCheckEvidence는 false', () => {
  assert.equal(canCheckEvidence('screenshot', []), false)
  assert.equal(canCheckEvidence('screenshot', undefined), false)
})
check('다른 종류의 첨부만 있으면 여전히 false (종류까지 정확히 일치해야 함)', () => {
  const attachments = [{ kind: 'test_log', filename: 'log.txt' }]
  assert.equal(canCheckEvidence('screenshot', attachments), false)
  assert.equal(hasAttachmentOfKind(attachments, 'test_log'), true)
})
check('해당 종류의 첨부가 하나라도 있으면 true', () => {
  const attachments = [
    { kind: 'test_log', filename: 'log.txt' },
    { kind: 'screenshot', filename: 'shot.png' },
  ]
  assert.equal(canCheckEvidence('screenshot', attachments), true)
})

console.log(`\n총 ${passed}개 테스트 통과`)
