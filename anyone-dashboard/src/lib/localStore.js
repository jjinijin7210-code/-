// ============================================================
// 애니원(AnyOne) 로컬 저장소 어댑터
//
// Supabase를 아직 설정하지 않았거나, 일반 브라우저에서 바로 켜봐야 할 때
// window.storage(프로토타입 전용) 대신 이 모듈이 localStorage로 데이터를 다룹니다.
//
// 순수 함수로 작성해서 브라우저 없이 Node.js에서도 직접 실행/테스트할 수 있게 했습니다.
// (테스트 파일: scripts/test-local-store.mjs 참고)
// ============================================================

export const ANYONE_TABLES = [
  'employee_status',
  'content_drafts',
  'review_log',
  'benchmark_reports',
  'cs_links',
  'analytics_data',
  'qa_pipeline',
  'qa_review_steps',
  'luna_requests',
  'luna_staff',
  'june_character',
  'brands',
  'assets',
  'briefings',
]

const KEY_PREFIX = 'anyone'
const tableKey = (table) => `${KEY_PREFIX}:${table}`
const trashKey = (table) => `${KEY_PREFIX}:${table}:trash`

// 브라우저의 crypto.randomUUID가 없을 수도 있어 대체 함수 준비
function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

function nowIso() {
  return new Date().toISOString()
}

/**
 * localStorage(혹은 테스트용으로 주입한 엔진)를 감싸는 저장소 객체를 만듭니다.
 * @param {Storage} engine - window.localStorage 또는 동일한 인터페이스를 가진 객체
 */
export function createLocalStore(engine) {
  if (!engine) throw new Error('저장소 엔진(engine)이 필요합니다. window.localStorage를 전달하세요.')

  function readJson(key, fallback) {
    try {
      const raw = engine.getItem(key)
      if (raw == null) return fallback
      return JSON.parse(raw)
    } catch (e) {
      // JSON이 깨져있거나 접근 자체가 막힌 경우(예: 시크릿 모드 저장 용량 초과)
      return fallback
    }
  }

  function writeJson(key, value) {
    try {
      engine.setItem(key, JSON.stringify(value))
      return { ok: true }
    } catch (e) {
      // 저장 실패 - 용량 초과(QuotaExceededError) 등
      return { ok: false, error: e?.message || String(e) }
    }
  }

  function getAll(table) {
    return readJson(tableKey(table), [])
  }

  function getTrash(table) {
    return readJson(trashKey(table), [])
  }

  function insert(table, values) {
    const rows = getAll(table)
    const record = {
      id: genId(),
      created_at: nowIso(),
      updated_at: nowIso(),
      ...values,
    }
    rows.unshift(record)
    const result = writeJson(tableKey(table), rows)
    return { ...result, record }
  }

  function update(table, id, values) {
    const rows = getAll(table)
    const idx = rows.findIndex((r) => r.id === id)
    if (idx === -1) return { ok: false, error: '해당 id를 찾을 수 없어요.' }
    rows[idx] = { ...rows[idx], ...values, updated_at: nowIso() }
    const result = writeJson(tableKey(table), rows)
    return { ...result, record: rows[idx] }
  }

  // 완전 삭제 대신 휴지통으로 이동 (복구 가능)
  function softDelete(table, id) {
    const rows = getAll(table)
    const idx = rows.findIndex((r) => r.id === id)
    if (idx === -1) return { ok: false, error: '해당 id를 찾을 수 없어요.' }
    const [removed] = rows.splice(idx, 1)
    const trash = getTrash(table)
    trash.unshift({ ...removed, __deleted_at: nowIso() })

    const r1 = writeJson(tableKey(table), rows)
    const r2 = writeJson(trashKey(table), trash)
    return { ok: r1.ok && r2.ok, error: r1.error || r2.error }
  }

  // 휴지통에서 복구
  function restore(table, id) {
    const trash = getTrash(table)
    const idx = trash.findIndex((r) => r.id === id)
    if (idx === -1) return { ok: false, error: '휴지통에서 해당 id를 찾을 수 없어요.' }
    const [restored] = trash.splice(idx, 1)
    delete restored.__deleted_at
    const rows = getAll(table)
    rows.unshift(restored)

    const r1 = writeJson(tableKey(table), rows)
    const r2 = writeJson(trashKey(table), trash)
    return { ok: r1.ok && r2.ok, error: r1.error || r2.error }
  }

  // 휴지통에서 완전 삭제 (되돌릴 수 없음)
  function permanentDelete(table, id) {
    const trash = getTrash(table)
    const next = trash.filter((r) => r.id !== id)
    return writeJson(trashKey(table), next)
  }

  // 전체 데이터 내보내기 (백업용 JSON)
  function exportAll() {
    const data = {}
    for (const table of ANYONE_TABLES) {
      data[table] = getAll(table)
      data[`${table}__trash`] = getTrash(table)
    }
    return {
      meta: {
        app: 'anyone-dashboard',
        exported_at: nowIso(),
        version: 1,
      },
      data,
    }
  }

  // 백업 JSON 복원. mode: 'replace'(전체 교체) | 'merge'(id 겹치면 덮어쓰기, 아니면 추가)
  function importAll(backup, mode = 'replace') {
    if (!backup || typeof backup !== 'object' || !backup.data) {
      return { ok: false, error: '백업 파일 형식이 올바르지 않아요 (data 필드가 없음).' }
    }
    try {
      for (const table of ANYONE_TABLES) {
        const incoming = Array.isArray(backup.data[table]) ? backup.data[table] : []
        const incomingTrash = Array.isArray(backup.data[`${table}__trash`])
          ? backup.data[`${table}__trash`]
          : []

        if (mode === 'replace') {
          writeJson(tableKey(table), incoming)
          writeJson(trashKey(table), incomingTrash)
        } else {
          const current = getAll(table)
          const byId = new Map(current.map((r) => [r.id, r]))
          for (const rec of incoming) byId.set(rec.id, rec)
          writeJson(tableKey(table), Array.from(byId.values()))
        }
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    }
  }

  // 전체 초기화 (모든 테이블 + 휴지통 비우기)
  function resetAll() {
    try {
      for (const table of ANYONE_TABLES) {
        engine.removeItem(tableKey(table))
        engine.removeItem(trashKey(table))
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    }
  }

  function deleteRowPermanently(table, id) {
    // 휴지통을 거치지 않고 즉시 영구 삭제하고 싶을 때 사용
    const rows = getAll(table)
    const next = rows.filter((r) => r.id !== id)
    return writeJson(tableKey(table), next)
  }

  return {
    getAll,
    getTrash,
    insert,
    update,
    softDelete,
    restore,
    permanentDelete,
    deleteRowPermanently,
    exportAll,
    importAll,
    resetAll,
  }
}
