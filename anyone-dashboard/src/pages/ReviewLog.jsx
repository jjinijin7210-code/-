import { useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { useConfirm } from '../components/ConfirmDialog'
import SaveStatusIndicator from '../components/SaveStatusIndicator'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import StatusBadge from '../components/StatusBadge'
import { LoadingView, ErrorView, EmptyView } from '../components/StateViews'

const REVIEWER_OPTIONS = ['검수자', '최종 매니저']
const CHECK_TYPE_OPTIONS = ['팩트체크', '자연스러움(AI스러움)', '식품표시광고법', '최종승인']
const RESULT_OPTIONS = ['대기', '통과', '반려']

const emptyForm = {
  draft_id: '',
  reviewer_role: REVIEWER_OPTIONS[0],
  check_type: CHECK_TYPE_OPTIONS[0],
  result: '대기',
  reason: '',
}

export default function ReviewLog() {
  const { rows, loading, error, saveStatus, insertRow, updateRow, deleteRow } = useSupabaseTable('review_log', {
    orderBy: 'checked_at',
  })
  const { rows: drafts } = useSupabaseTable('content_drafts')
  const confirm = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const draftTitle = (id) => drafts.find((d) => d.id === id)?.title || '(삭제된 초안)'

  const openAdd = () => {
    setEditing(null)
    setForm({ ...emptyForm, draft_id: drafts[0]?.id || '' })
    setModalOpen(true)
  }
  const openEdit = (row) => {
    setEditing(row)
    setForm(row)
    setModalOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (editing) await updateRow(editing.id, form)
    else await insertRow(form)
    setModalOpen(false)
  }

  return (
    <div>
      <PageHeader
        title="검수 로그"
        emoji="✅"
        description="검수자·매니저가 무엇을 확인했고 무엇을 반려했는지 기록"
        onAddClick={openAdd}
        addLabel="검수 기록 추가"
      />

      {loading && <LoadingView />}
      {error && <ErrorView message={error} />}
      {!loading && !error && rows.length === 0 && <EmptyView />}

      <div className="space-y-2">
        {rows.map((row) => (
          <button
            key={row.id}
            onClick={() => openEdit(row)}
            className="block w-full rounded-xl bg-paper-card p-4 text-left shadow-card transition hover:shadow-md"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{draftTitle(row.draft_id)}</span>
              <StatusBadge status={row.result} />
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink/50">
              <span>{row.reviewer_role}</span>
              <span>·</span>
              <span>{row.check_type}</span>
            </div>
            {row.reason && <p className="mt-1 text-xs text-ink/60">{row.reason}</p>}
          </button>
        ))}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? '검수 기록 수정' : '검수 기록 추가'}>
        <form onSubmit={handleSave}>
          <FormField
            label="대상 초안"
            type="select"
            options={drafts.map((d) => ({ value: d.id, label: d.title }))}
            value={form.draft_id}
            onChange={(v) => setForm({ ...form, draft_id: v })}
          />
          <FormField
            label="검수자"
            type="select"
            options={REVIEWER_OPTIONS}
            value={form.reviewer_role}
            onChange={(v) => setForm({ ...form, reviewer_role: v })}
          />
          <FormField
            label="점검 항목"
            type="select"
            options={CHECK_TYPE_OPTIONS}
            value={form.check_type}
            onChange={(v) => setForm({ ...form, check_type: v })}
          />
          <FormField
            label="결과"
            type="select"
            options={RESULT_OPTIONS}
            value={form.result}
            onChange={(v) => setForm({ ...form, result: v })}
          />
          <FormField label="사유/메모" type="textarea" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} />

          <div className="mt-4 flex items-center justify-between">
            {editing && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirm('이 검수 기록을 삭제할까요? 휴지통으로 이동해요.')
                  if (!ok) return
                  await deleteRow(editing.id)
                  setModalOpen(false)
                }}
                className="text-sm text-stamp-reject hover:underline"
              >
                삭제
              </button>
            )}
            <div className="ml-auto flex items-center gap-3">
              <SaveStatusIndicator status={saveStatus} />
              <button type="submit" className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90">
                저장
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
