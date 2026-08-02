import { useRef, useState } from 'react'
import { useConfirm } from '../components/ConfirmDialog'
import { createLocalStore, ANYONE_TABLES } from '../lib/localStore'
import { isSupabaseConfigured } from '../lib/supabaseClient'

const TABLE_LABELS = {
  employee_status: '직원 현황',
  content_drafts: '콘텐츠 초안',
  review_log: '검수 로그',
  benchmark_reports: '벤치마킹 리포트',
  cs_links: 'CS 링크',
  assets: '에셋 보관함',
  briefings: '아침 브리핑',
  automation_runs: '자동화 실행 로그',
}

function getStore() {
  if (typeof window === 'undefined') return null
  return createLocalStore(window.localStorage)
}

export default function Settings() {
  const confirm = useConfirm()
  const fileInputRef = useRef(null)
  const [message, setMessage] = useState(null) // { type: 'success'|'error', text }
  const [trashByTable, setTrashByTable] = useState(() => {
    const store = getStore()
    if (!store) return {}
    const out = {}
    for (const t of ANYONE_TABLES) out[t] = store.getTrash(t)
    return out
  })

  const refreshTrash = () => {
    const store = getStore()
    const out = {}
    for (const t of ANYONE_TABLES) out[t] = store.getTrash(t)
    setTrashByTable(out)
  }

  const handleExport = () => {
    const store = getStore()
    if (!store) return
    const backup = store.exportAll()
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const dateStr = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `anyone-backup-${dateStr}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMessage({ type: 'success', text: '백업 파일을 내려받았어요.' })
  }

  const handleImportClick = () => fileInputRef.current?.click()

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const json = JSON.parse(text)

      const ok = await confirm(
        '지금 저장된 데이터를 백업 파일 내용으로 완전히 교체해요. 계속할까요?',
        { confirmLabel: '복원', danger: true }
      )
      if (!ok) return

      const store = getStore()
      const res = store.importAll(json, 'replace')
      if (!res.ok) {
        setMessage({ type: 'error', text: `복원 실패: ${res.error}` })
        return
      }
      setMessage({ type: 'success', text: '백업 파일로 복원했어요. 화면을 새로고침 해주세요.' })
      refreshTrash()
    } catch (err) {
      setMessage({ type: 'error', text: `파일을 읽지 못했어요: ${err.message}` })
    } finally {
      e.target.value = '' // 같은 파일 다시 선택 가능하도록 초기화
    }
  }

  const handleReset = async () => {
    const ok = await confirm(
      '정말 모든 데이터를 초기화할까요? 이 작업은 되돌릴 수 없어요 (백업을 먼저 받아두는 걸 권장해요).',
      { confirmLabel: '전체 초기화', danger: true }
    )
    if (!ok) return
    const store = getStore()
    const res = store.resetAll()
    if (res.ok) {
      setMessage({ type: 'success', text: '초기화했어요. 화면을 새로고침 해주세요.' })
      refreshTrash()
    } else {
      setMessage({ type: 'error', text: `초기화 실패: ${res.error}` })
    }
  }

  const handleRestore = (table, id) => {
    const store = getStore()
    const res = store.restore(table, id)
    if (res.ok) {
      setMessage({ type: 'success', text: '복구했어요. 해당 탭에서 화면을 새로고침 해주세요.' })
      refreshTrash()
    } else {
      setMessage({ type: 'error', text: `복구 실패: ${res.error}` })
    }
  }

  const handlePermanentDelete = async (table, id) => {
    const ok = await confirm('휴지통에서 완전히 삭제할까요? 복구할 수 없어요.', { confirmLabel: '완전 삭제' })
    if (!ok) return
    const store = getStore()
    store.permanentDelete(table, id)
    refreshTrash()
  }

  const totalTrash = Object.values(trashByTable).reduce((sum, arr) => sum + arr.length, 0)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-ink md:text-2xl">⚙️ 설정 · 백업</h1>
        <p className="mt-1 text-sm text-ink/60">
          현재 저장 모드: {isSupabaseConfigured ? 'Supabase (실제 DB)' : '브라우저 localStorage'}
        </p>
      </div>

      {!isSupabaseConfigured && (
        <div className="rounded-lg border border-stamp-amber/30 bg-stamp-amber/5 p-3 text-xs text-ink/70">
          💡 지금은 Supabase가 설정되지 않아 이 브라우저에만 데이터가 저장돼요. 다른 기기·브라우저에서는 보이지
          않으니, 정기적으로 아래에서 백업 파일을 받아두는 걸 권장해요.
        </div>
      )}

      {message && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            message.type === 'success'
              ? 'border-stamp-pass/30 bg-stamp-pass/5 text-stamp-pass'
              : 'border-stamp-reject/30 bg-stamp-reject/5 text-stamp-reject'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* 백업 / 복원 / 초기화 */}
      <section className="rounded-xl bg-paper-card p-5 shadow-card">
        <h2 className="mb-3 text-sm font-bold text-ink/70">데이터 백업 / 복원 / 초기화</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleExport}
            className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90"
          >
            📥 전체 백업 (JSON 내보내기)
          </button>
          <button
            onClick={handleImportClick}
            className="rounded-md border border-ink/15 px-4 py-2 text-sm font-semibold text-ink hover:bg-ink/5"
          >
            📤 백업 파일 불러오기
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            onChange={handleImportFile}
            className="hidden"
          />
          <button
            onClick={handleReset}
            className="rounded-md border border-stamp-reject/30 px-4 py-2 text-sm font-semibold text-stamp-reject hover:bg-stamp-reject/5"
          >
            🗑 전체 초기화
          </button>
        </div>
      </section>

      {/* 휴지통 */}
      <section>
        <h2 className="mb-3 text-sm font-bold text-ink/70">🗑 휴지통 ({totalTrash})</h2>
        {totalTrash === 0 ? (
          <p className="rounded-lg border border-dashed border-ink/15 py-8 text-center text-sm text-ink/40">
            휴지통이 비어있어요.
          </p>
        ) : (
          <div className="space-y-4">
            {ANYONE_TABLES.filter((t) => trashByTable[t]?.length).map((table) => (
              <div key={table}>
                <p className="mb-2 text-xs font-semibold text-ink/50">{TABLE_LABELS[table]}</p>
                <div className="space-y-2">
                  {trashByTable[table].map((row) => (
                    <div
                      key={row.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-paper-card p-3 shadow-card"
                    >
                      <span className="truncate text-sm">
                        {row.title || row.request_title || row.item_name || row.role_name || row.keyword || row.trigger_keyword || row.briefing_date || row.id}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRestore(table, row.id)}
                          className="rounded-md bg-stamp-pass/10 px-3 py-1 text-xs font-semibold text-stamp-pass hover:bg-stamp-pass/20"
                        >
                          복구
                        </button>
                        <button
                          onClick={() => handlePermanentDelete(table, row.id)}
                          className="rounded-md bg-stamp-reject/10 px-3 py-1 text-xs font-semibold text-stamp-reject hover:bg-stamp-reject/20"
                        >
                          완전 삭제
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
