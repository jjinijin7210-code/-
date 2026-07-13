import { useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { useConfirm } from '../components/ConfirmDialog'
import SaveStatusIndicator from '../components/SaveStatusIndicator'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import StatusBadge from '../components/StatusBadge'
import { LoadingView, ErrorView, EmptyView } from '../components/StateViews'

const STATUS_OPTIONS = ['대기', '작업중', '완료', '이슈발생']
const ROLE_PRESETS = ['리서처', '작성자', '검수자', '발행 담당', '모니터링 담당', '최종 매니저']

const emptyForm = { role_name: ROLE_PRESETS[0], role_emoji: '🤖', status: '대기', current_task: '', note: '' }

export default function EmployeeStatus() {
  const { rows, loading, error, saveStatus, insertRow, updateRow, deleteRow } = useSupabaseTable('employee_status', {
    orderBy: 'updated_at',
  })
  const confirm = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const openAdd = () => {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }
  const openEdit = (row) => {
    setEditing(row)
    setForm(row)
    setModalOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (editing) {
      await updateRow(editing.id, form)
    } else {
      await insertRow(form)
    }
    setModalOpen(false)
  }

  return (
    <div>
      <PageHeader
        title="직원 현황"
        emoji="🧑‍💼"
        description="리서처·작성자·검수자·발행 담당·모니터링 담당·최종 매니저의 현재 작업 상태"
        onAddClick={openAdd}
        addLabel="직원 추가"
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
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-semibold">
                <span aria-hidden>{row.role_emoji}</span>
                {row.role_name}
              </span>
              <StatusBadge status={row.status} />
            </div>
            {row.current_task && <p className="mt-2 text-xs text-ink/60">{row.current_task}</p>}
            {row.note && <p className="mt-1 text-xs text-ink/40">{row.note}</p>}
          </button>
        ))}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? '직원 정보 수정' : '직원 추가'}>
        <form onSubmit={handleSave}>
          <FormField
            label="역할"
            type="select"
            options={ROLE_PRESETS}
            value={form.role_name}
            onChange={(v) => setForm({ ...form, role_name: v })}
          />
          <FormField
            label="이모지"
            value={form.role_emoji}
            onChange={(v) => setForm({ ...form, role_emoji: v })}
          />
          <FormField
            label="상태"
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
            {editing && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirm('이 직원 정보를 삭제할까요? 휴지통으로 이동해요.')
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
              <button
                type="submit"
                className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90"
              >
                저장
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
