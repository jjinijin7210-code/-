import { useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { useConfirm } from '../components/ConfirmDialog'
import SaveStatusIndicator from '../components/SaveStatusIndicator'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import AttachmentSection from '../components/AttachmentSection'
import { LoadingView, ErrorView, EmptyView } from '../components/StateViews'
import { JUNE_VIEW_KINDS, JUNE_TEXT_FIELDS, getEmptyJuneCharacter, buildJuneSummary } from '../lib/juneCharacter'

export default function JuneCharacter() {
  const { rows, loading, error, saveStatus, insertRow, updateRow, deleteRow } = useSupabaseTable('june_character', {
    orderBy: 'created_at',
  })
  const confirm = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(getEmptyJuneCharacter())

  const activeVersion = rows.find((v) => v.is_active)

  const openAdd = () => {
    setEditing(null)
    setForm(getEmptyJuneCharacter())
    setModalOpen(true)
  }
  const openEdit = (row) => {
    setEditing(row)
    setForm({ ...getEmptyJuneCharacter(), ...row, views: row.views || [] })
    setModalOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (editing) await updateRow(editing.id, form)
    else await insertRow(form)
    setModalOpen(false)
  }

  // 이 버전을 "공식"으로 지정 - 나머지 버전은 자동으로 비활성화됨 (항상 활성은 최대 1개)
  const handleActivate = async (row) => {
    const ok = await confirm(`"${row.version || '(버전명 없음)'}"을 June 공식 캐릭터 기준으로 지정할까요?`, {
      confirmLabel: '지정',
      danger: false,
    })
    if (!ok) return
    for (const v of rows) {
      if (v.is_active && v.id !== row.id) await updateRow(v.id, { is_active: false })
    }
    await updateRow(row.id, { is_active: true })
  }

  return (
    <div>
      <PageHeader
        title="June 캐릭터 관리실"
        emoji="🧸"
        description="June 공식 캐릭터 기준을 버전으로 관리해요. '공식 지정'된 버전은 루나 요청서에 자동으로 반영됩니다."
        onAddClick={openAdd}
        addLabel="버전 추가"
      />

      <div className="mb-4 rounded-lg border border-stamp-amber/30 bg-stamp-amber/5 p-3 text-xs text-ink/70">
        {activeVersion ? (
          <>
            🟢 현재 공식 기준: <strong>{activeVersion.version || '(버전명 없음)'}</strong> ·{' '}
            {buildJuneSummary(activeVersion) || '속성 미입력'}
          </>
        ) : (
          '아직 공식으로 지정된 버전이 없어요. 버전을 만들고 "공식 지정"을 눌러주세요.'
        )}
      </div>

      {loading && <LoadingView />}
      {error && <ErrorView message={error} />}
      {!loading && !error && rows.length === 0 && <EmptyView label="아직 등록된 캐릭터 버전이 없어요." />}

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-xl bg-paper-card p-4 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button onClick={() => openEdit(row)} className="text-left font-semibold hover:underline">
                {row.version || '(버전명 없음)'}
              </button>
              {row.is_active ? (
                <span className="stamp-badge border-stamp-pass text-stamp-pass bg-stamp-pass/5">🟢 공식 지정됨</span>
              ) : (
                <button
                  onClick={() => handleActivate(row)}
                  className="rounded-md border border-ink/15 px-2 py-1 text-[11px] font-semibold text-ink/60 hover:bg-ink/5"
                >
                  공식 지정하기
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-ink/50">{buildJuneSummary(row) || '속성 미입력'}</p>
          </div>
        ))}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? '버전 수정' : '버전 추가'}>
        <form onSubmit={handleSave}>
          <FormField
            label="버전 정보"
            required
            hint="예: v1.0, 2026-07 리뉴얼 등"
            value={form.version}
            onChange={(v) => setForm({ ...form, version: v })}
          />

          <div className="my-3">
            <p className="mb-2 text-xs font-bold text-ink/70">🖼 레퍼런스 이미지</p>
            <AttachmentSection
              attachments={form.views}
              kinds={JUNE_VIEW_KINDS}
              onChange={(next) => setForm({ ...form, views: next })}
            />
          </div>

          <div className="my-3 space-y-1 rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
            <p className="mb-2 text-xs font-bold text-ink/70">캐릭터 속성</p>
            {JUNE_TEXT_FIELDS.map((f) => (
              <FormField
                key={f.key}
                label={f.label}
                type={f.type}
                value={form[f.key]}
                onChange={(v) => setForm({ ...form, [f.key]: v })}
              />
            ))}
          </div>

          <FormField label="메모" type="textarea" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />

          <div className="mt-4 flex items-center justify-between">
            {editing && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirm('이 버전을 삭제할까요? 휴지통으로 이동해요.')
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
