import { useEffect, useRef, useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { useConfirm } from '../components/ConfirmDialog'
import SaveStatusIndicator from '../components/SaveStatusIndicator'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import StatusBadge from '../components/StatusBadge'
import { LoadingView, ErrorView } from '../components/StateViews'
import { DEFAULT_ROSTER, DEPARTMENT_ORDER, LUNA_STATUS_OPTIONS } from '../data/lunaRoster'

const STATUS_OPTIONS = LUNA_STATUS_OPTIONS

export default function LunaStudio() {
  const { rows, loading, error, saveStatus, insertRow, updateRow, deleteRow } = useSupabaseTable('luna_staff', {
    orderBy: 'department',
  })
  const confirm = useConfirm()
  const [expanded, setExpanded] = useState(true)
  const [openDepartments, setOpenDepartments] = useState(() => new Set(DEPARTMENT_ORDER))
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(null)
  const seededRef = useRef(false)

  // 테이블이 비어있으면(=처음 사용) 기본 조직도를 자동으로 채워넣음 (한 번만 실행)
  useEffect(() => {
    if (loading || seededRef.current || rows.length > 0) return
    seededRef.current = true
    ;(async () => {
      for (const person of DEFAULT_ROSTER) {
        await insertRow({ ...person, status: '대기' })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, rows.length])

  const toggleDepartment = (dept) => {
    setOpenDepartments((prev) => {
      const next = new Set(prev)
      if (next.has(dept)) next.delete(dept)
      else next.add(dept)
      return next
    })
  }

  const openEdit = (row) => {
    setEditing(row)
    setForm(row)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    await updateRow(editing.id, form)
    setEditing(null)
  }

  const handleDelete = async () => {
    const ok = await confirm('이 직원 슬롯을 삭제할까요? (조직도에서 빠집니다)')
    if (!ok) return
    await deleteRow(editing.id)
    setEditing(null)
  }

  const grouped = DEPARTMENT_ORDER.map((dept) => ({
    department: dept,
    members: rows.filter((r) => r.department === dept),
  })).filter((g) => g.members.length > 0)

  return (
    <div>
      {/* 조직 전체를 펼치고 접는 헤더 */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="mb-4 flex w-full items-center justify-between rounded-xl bg-ink px-5 py-4 text-left text-white shadow-card"
      >
        <div>
          <p className="font-mono text-[11px] tracking-widest text-stamp-amber">EXTERNAL PARTNER</p>
          <h1 className="text-lg font-bold">🌙 Luna Creative Studio</h1>
          <p className="mt-0.5 text-xs text-white/60">
            {rows.length}명 · 디자인·이미지·영상·브랜드·QA를 담당하는 외부 크리에이티브 조직
          </p>
        </div>
        <span className="text-xl">{expanded ? '▾' : '▸'}</span>
      </button>

      {loading && <LoadingView />}
      {error && <ErrorView message={error} />}

      {expanded && !loading && !error && (
        <div className="space-y-4">
          {grouped.map(({ department, members }) => {
            const isOpen = openDepartments.has(department)
            return (
              <div key={department} className="rounded-xl bg-paper-card shadow-card">
                <button
                  onClick={() => toggleDepartment(department)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <span className="font-semibold text-ink">
                    {department} <span className="ml-1 text-xs font-normal text-ink/40">({members.length})</span>
                  </span>
                  <span className="text-ink/40">{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && (
                  <div className="grid grid-cols-1 gap-2 border-t border-ink/5 p-3 sm:grid-cols-2 lg:grid-cols-3">
                    {members.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => openEdit(m)}
                        className="rounded-lg border border-ink/10 p-3 text-left hover:bg-ink/[0.03]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{m.role_name}</span>
                          <StatusBadge status={m.status} />
                        </div>
                        {m.current_task && <p className="mt-1 truncate text-xs text-ink/50">{m.current_task}</p>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {grouped.length === 0 && (
            <p className="rounded-lg border border-dashed border-ink/15 py-8 text-center text-sm text-ink/40">
              조직도를 불러오는 중이에요...
            </p>
          )}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.role_name}>
        {form && (
          <form onSubmit={handleSave}>
            <p className="mb-3 text-xs text-ink/50">{form.department}</p>
            <FormField
              label="업무 상태"
              type="select"
              options={STATUS_OPTIONS}
              value={form.status}
              onChange={(v) => setForm({ ...form, status: v })}
            />
            <FormField
              label="지금 하는 작업"
              type="textarea"
              value={form.current_task}
              onChange={(v) => setForm({ ...form, current_task: v })}
            />
            <FormField label="메모" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />

            <div className="mt-4 flex items-center justify-between">
              <button type="button" onClick={handleDelete} className="text-sm text-stamp-reject hover:underline">
                슬롯 삭제
              </button>
              <div className="ml-auto flex items-center gap-3">
                <SaveStatusIndicator status={saveStatus} />
                <button
                  type="submit"
                  className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90"
                >
                  저장
                </button>
              </div>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
