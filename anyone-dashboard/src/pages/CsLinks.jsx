import { useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { useConfirm } from '../components/ConfirmDialog'
import SaveStatusIndicator from '../components/SaveStatusIndicator'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import { LoadingView, ErrorView, EmptyView } from '../components/StateViews'
import { isValidUrl } from '../lib/contentPreview'
import { isDuplicate } from '../lib/validation'

const CATEGORY_OPTIONS = ['인테리어/생활용품', '푸드쇼핑']

const emptyForm = {
  trigger_keyword: '',
  target_url: 'https://link.inpock.co.kr/jena10',
  category: CATEGORY_OPTIONS[0],
  note: '',
  active: true,
}

export default function CsLinks() {
  const { rows, loading, error, saveStatus, insertRow, updateRow, deleteRow } = useSupabaseTable('cs_links')
  const confirm = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState(null)

  const openAdd = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }
  const openEdit = (row) => {
    setEditing(row)
    setForm(row)
    setFormError(null)
    setModalOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setFormError(null)

    if (!isValidUrl(form.target_url)) {
      setFormError('링크 형식이 올바르지 않아요 (http:// 또는 https://로 시작해야 해요).')
      return
    }

    // 이미 같은 키워드가 등록되어 있으면 경고하고 한 번 더 확인받음 (오작동 방지)
    if (isDuplicate(rows, 'trigger_keyword', form.trigger_keyword, editing?.id)) {
      const ok = await confirm(
        `이미 "${form.trigger_keyword.trim()}" 키워드가 등록되어 있어요. 그래도 계속 저장할까요?`,
        { confirmLabel: '그래도 저장', danger: false }
      )
      if (!ok) return
    }

    if (editing) await updateRow(editing.id, form)
    else await insertRow(form)
    setModalOpen(false)
  }

  return (
    <div>
      <PageHeader
        title="CS 링크 관리"
        emoji="💬"
        description='댓글에 트리거 키워드가 오면 매칭된 링크를 답글로 보낼 매핑표 (발송은 반자동 - 사람 승인 후 진행)'
        onAddClick={openAdd}
        addLabel="링크 추가"
      />

      <div className="mb-4 rounded-lg border border-ink/10 bg-ink/[0.03] p-3 text-xs text-ink/60">
        💡 지금 단계에서는 댓글 자동 감지·자동 발송을 구현하지 않아요. 사람이 승인하는 반자동 방식으로 운영합니다.
      </div>

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
              <span className="font-semibold">"{row.trigger_keyword}"</span>
              <span
                className={`stamp-badge ${
                  row.active
                    ? 'border-stamp-pass text-stamp-pass bg-stamp-pass/5'
                    : 'border-stamp-pending text-stamp-pending bg-stamp-pending/5'
                }`}
              >
                {row.active ? '사용중' : '비활성'}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-ink/50">{row.target_url}</p>
            <p className="mt-1 text-xs text-ink/40">{row.category}</p>
          </button>
        ))}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'CS 링크 수정' : 'CS 링크 추가'}>
        <form onSubmit={handleSave}>
          <FormField
            label="트리거 키워드"
            required
            hint='예: "핑크" — 글마다 다르게 지정 가능'
            value={form.trigger_keyword}
            onChange={(v) => setForm({ ...form, trigger_keyword: v })}
          />
          <FormField
            label="연결할 링크 (인포크 딥링크 or 프로필)"
            required
            error={formError?.includes('링크 형식')}
            hint="http(s)://로 시작해야 해요"
            value={form.target_url}
            onChange={(v) => setForm({ ...form, target_url: v })}
          />
          <FormField
            label="카테고리"
            type="select"
            options={CATEGORY_OPTIONS}
            value={form.category}
            onChange={(v) => setForm({ ...form, category: v })}
          />
          <FormField label="메모" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />
          <FormField
            type="checkbox"
            label="현재 사용중인 링크"
            value={form.active}
            onChange={(v) => setForm({ ...form, active: v })}
          />

          {formError && <p className="mb-2 text-xs text-stamp-reject">{formError}</p>}

          <div className="mt-4 flex items-center justify-between">
            {editing && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirm('이 CS 링크를 삭제할까요? 휴지통으로 이동해요.')
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
