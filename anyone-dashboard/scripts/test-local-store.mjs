// 브라우저 없이 Node.js에서 localStore.js 로직을 실제로 실행해보는 테스트 스크립트.
// 실행: node scripts/test-local-store.mjs
//
// localStorage가 없는 Node 환경이므로, 동일한 인터페이스(getItem/setItem/removeItem)를
// 가진 간단한 Map 기반 가짜 저장소를 만들어 주입합니다. 로직 자체는 실제 브라우저의
// localStorage와 완전히 동일하게 동작합니다 (JSON 문자열 read/write).

import assert from 'node:assert/strict'
import { createLocalStore, ANYONE_TABLES } from '../src/lib/localStore.js'

// --- 가짜 localStorage 구현 (Map 기반) ---
function makeFakeStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  }
}

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

console.log('=== 1. 기본 insert/update/조회 ===')
{
  const store = createLocalStore(makeFakeStorage())

  check('insert 시 ok:true와 record 반환', () => {
    const res = store.insert('content_drafts', { title: '테스트 초안', status: '초안' })
    assert.equal(res.ok, true)
    assert.equal(res.record.title, '테스트 초안')
    assert.ok(res.record.id)
    assert.ok(res.record.created_at)
  })

  check('insert 후 getAll에 반영됨', () => {
    const rows = store.getAll('content_drafts')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].title, '테스트 초안')
  })

  check('update 시 값이 반영되고 updated_at이 갱신됨', () => {
    const rows = store.getAll('content_drafts')
    const id = rows[0].id
    const before = rows[0].updated_at
    const res = store.update('content_drafts', id, { status: '통과' })
    assert.equal(res.ok, true)
    assert.equal(res.record.status, '통과')
    assert.ok(res.record.updated_at >= before)
  })
}

console.log('=== 2. 소프트 삭제(휴지통) + 복구 ===')
{
  const store = createLocalStore(makeFakeStorage())
  const { record } = store.insert('cs_links', { trigger_keyword: '핑크', target_url: 'https://example.com' })

  check('softDelete 후 원본 테이블에서 사라짐', () => {
    const res = store.softDelete('cs_links', record.id)
    assert.equal(res.ok, true)
    const rows = store.getAll('cs_links')
    assert.equal(rows.length, 0)
  })

  check('softDelete 후 휴지통에 존재함', () => {
    const trash = store.getTrash('cs_links')
    assert.equal(trash.length, 1)
    assert.equal(trash[0].trigger_keyword, '핑크')
    assert.ok(trash[0].__deleted_at)
  })

  check('restore 하면 원본 테이블로 복귀하고 휴지통에서 사라짐', () => {
    const res = store.restore('cs_links', record.id)
    assert.equal(res.ok, true)
    const rows = store.getAll('cs_links')
    const trash = store.getTrash('cs_links')
    assert.equal(rows.length, 1)
    assert.equal(trash.length, 0)
    assert.equal(rows[0].__deleted_at, undefined)
  })

  check('permanentDelete 하면 휴지통에서도 완전히 사라짐', () => {
    store.softDelete('cs_links', record.id)
    const res = store.permanentDelete('cs_links', record.id)
    assert.equal(res.ok, true)
    assert.equal(store.getTrash('cs_links').length, 0)
  })
}

console.log('=== 3. 전체 백업(export) / 복원(import) / 초기화(reset) ===')
{
  const store = createLocalStore(makeFakeStorage())
  store.insert('employee_status', { role_name: '리서처', status: '작업중' })
  store.insert('luna_requests', { request_title: '캐릭터 이미지 요청' })

  let backup
  check('exportAll이 모든 테이블을 포함한 JSON을 반환', () => {
    backup = store.exportAll()
    assert.ok(backup.meta.exported_at)
    for (const t of ANYONE_TABLES) {
      assert.ok(Array.isArray(backup.data[t]), `${t} 배열이 있어야 함`)
    }
    assert.equal(backup.data.employee_status.length, 1)
    assert.equal(backup.data.luna_requests.length, 1)
  })

  check('resetAll 이후 데이터가 모두 비워짐', () => {
    const res = store.resetAll()
    assert.equal(res.ok, true)
    assert.equal(store.getAll('employee_status').length, 0)
    assert.equal(store.getAll('luna_requests').length, 0)
  })

  check('importAll(backup)으로 데이터가 복원됨', () => {
    const res = store.importAll(backup, 'replace')
    assert.equal(res.ok, true)
    assert.equal(store.getAll('employee_status').length, 1)
    assert.equal(store.getAll('employee_status')[0].role_name, '리서처')
    assert.equal(store.getAll('luna_requests').length, 1)
  })

  check('importAll에 잘못된 형식을 주면 ok:false', () => {
    const res = store.importAll({ nope: true })
    assert.equal(res.ok, false)
  })
}

console.log('=== 4. 저장 실패 상황(용량 초과 등) 시뮬레이션 ===')
{
  const failingStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError (시뮬레이션)')
    },
    removeItem: () => {},
  }
  const store = createLocalStore(failingStorage)

  check('setItem이 실패하면 insert가 ok:false와 error 메시지를 반환', () => {
    const res = store.insert('content_drafts', { title: '실패 테스트' })
    assert.equal(res.ok, false)
    assert.ok(res.error.includes('QuotaExceededError'))
  })
}

console.log(`\n총 ${passed}개 테스트 통과`)
