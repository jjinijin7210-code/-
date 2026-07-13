import { useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { useConfirm } from '../components/ConfirmDialog'
import SaveStatusIndicator from '../components/SaveStatusIndicator'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import { LoadingView, ErrorView, EmptyView } from '../components/StateViews'

const emptyForm = { draft_id: '', views: 0, likes: 0, comments: 0, cs_trigger_count: 0 }

export default function AnalyticsData() {
  const { rows, loading, error, saveStatus, insertRow, updateRow, deleteRow } = useSupabaseTable('analytics_data', {
    orderBy: 'collected_at',
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
        title="성과 데이터"
        emoji="📊"
        description="발행 후 조회수·반응·CS 트리거 발송 횟수"
        onAddClick={openAdd}
        addLabel="성과 기록 추가"
      />

      {loading && <LoadingView />}
      {error && <ErrorView message={error} />}
      {!loading && !error && rows.length === 0 && <EmptyView />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <button
            key={row.id}
            onClick={() => openEdit(row)}
            className="rounded-xl bg-paper-card p-4 text-left shadow-card transition hover:shadow-md"
          >
            <p className="mb-2 truncate font-semibold">{draftTitle(row.draft_id)}</p>
            <div className="grid grid-cols-2 gap-2 text-xs text-ink/60">
              <span>조회수 {row.views}</span>
              <span>좋아요 {row.likes}</span>
              <span>댓글 {row.comments}</span>
              <span>CS 발송 {row.cs_trigger_count}</span>
            </div>
          </button>
        ))}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? '성과 기록 수정' : '성과 기록 추가'}>
        <form onSubmit={handleSave}>
          <FormField
            label="대상 초안"
            type="select"
            options={drafts.map((d) => ({ value: d.id, label: d.title }))}
            value={form.draft_id}
            onChange={(v) => setForm({ ...form, draft_id: v })}
          />
          <div className="grid grid-cols-2 gap-2">
            <FormField label="조회수" type="number" value={form.views} onChange={(v) => setForm({ ...form, views: v })} />
            <FormField label="좋아요" type="number" value={form.likes} onChange={(v) => setForm({ ...form, likes: v })} />
            <FormField
              label="댓글 수"
              type="number"
              value={form.comments}
              onChange={(v) => setForm({ ...form, comments: v })}
            />
            <FormField
              label="CS 발송 횟수"
              type="number"
              value={form.cs_trigger_count}
              onChange={(v) => setForm({ ...form, cs_trigger_count: v })}
            />
          </div>

          <div className="mt-4 flex items-center justify-between">
            {editing && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirm('이 성과 기록을 삭제할까요? 휴지통으로 이동해요.')
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
