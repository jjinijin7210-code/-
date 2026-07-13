import { useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { useConfirm } from '../components/ConfirmDialog'
import SaveStatusIndicator from '../components/SaveStatusIndicator'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import StatusBadge from '../components/StatusBadge'
import AttachmentSection from '../components/AttachmentSection'
import { canCheckEvidence } from '../lib/attachments'
import { LoadingView, ErrorView, EmptyView } from '../components/StateViews'
import { REQUEST_TYPES, REQUEST_STATUS_FLOW, getFieldsForType, getEmptyDetails } from '../data/lunaRequestFields'
import { getActiveVersion, applyJuneReferenceToRequest } from '../lib/juneCharacter'
import { isDuplicate } from '../lib/validation'

const DEPARTMENT_OPTIONS = ['아트본부', '영상본부', '콘텐츠본부', '브랜드본부', 'QA본부', '연구소']
// 최종적으로 "완료" 취급하는 상태 - 이 상태로 저장하려면 증거 5가지가 모두 갖춰져야 함
const TERMINAL_STATUS = '사용 완료'

function makeEmptyForm() {
  return {
    request_title: '',
    request_type: REQUEST_TYPES[0],
    department: DEPARTMENT_OPTIONS[0],
    status: REQUEST_STATUS_FLOW[0],
    details: getEmptyDetails(REQUEST_TYPES[0]),
    june_reference: null,
    evidence_summary: false,
    evidence_result: false,
    evidence_review: false,
    evidence_suggestion: false,
    evidence_screenshot: false, // 실행 화면 스크린샷을 실제로 첨부해야만 체크 가능
    attachments: [], // 실행화면/테스트로그/오류화면/작업파일/전후비교 실제 파일들
    note: '',
  }
}

function evidenceCount(row) {
  return [
    row.evidence_summary,
    row.evidence_result,
    row.evidence_review,
    row.evidence_suggestion,
    row.evidence_screenshot,
  ].filter(Boolean).length
}

export default function LunaRequests() {
  const { rows, loading, error, saveStatus, insertRow, updateRow, deleteRow } = useSupabaseTable('luna_requests', {
    orderBy: 'requested_at',
  })
  const { rows: juneVersions } = useSupabaseTable('june_character')
  const activeJune = getActiveVersion(juneVersions)
  const confirm = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(makeEmptyForm())
  const [formError, setFormError] = useState(null)
  const [juneMessage, setJuneMessage] = useState(null)

  const openAdd = () => {
    setEditing(null)
    setForm(makeEmptyForm())
    setFormError(null)
    setJuneMessage(null)
    setModalOpen(true)
  }
  const openEdit = (row) => {
    setEditing(row)
    // 예전 데이터(request_type/details가 없던 시절)를 열어도 안전하도록 기본값과 병합
    setForm({
      ...makeEmptyForm(),
      ...row,
      details: { ...getEmptyDetails(row.request_type || REQUEST_TYPES[0]), ...(row.details || {}) },
    })
    setFormError(null)
    setJuneMessage(null)
    setModalOpen(true)
  }

  // "June 공식 캐릭터 기준 포함" - 지금 활성화된 June 버전을 요청서에 자동으로 반영
  const handleApplyJune = () => {
    try {
      const updated = applyJuneReferenceToRequest(form, activeJune)
      setForm(updated)
      setJuneMessage({ type: 'success', text: `June 공식 기준(${activeJune.version})을 반영했어요.` })
    } catch (err) {
      setJuneMessage({ type: 'error', text: err.message })
    }
  }

  // 요청 종류를 바꾸면 세부 필드도 그 종류에 맞는 기본값으로 초기화
  const handleTypeChange = (type) => {
    setForm({ ...form, request_type: type, details: getEmptyDetails(type) })
  }

  const setDetail = (key, value) => {
    setForm({ ...form, details: { ...form.details, [key]: value } })
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setFormError(null)

    // 첨부가 사라졌는데 체크만 남아있는 경우를 방지 (첨부 없이는 체크된 상태로 저장 못 하게)
    const safeForm = {
      ...form,
      evidence_screenshot: form.evidence_screenshot && canCheckEvidence('screenshot', form.attachments),
    }

    // "완료했습니다"만으로 종료 금지 - 증거 5가지(스크린샷 첨부 포함)가 모두 제출되어야 "사용 완료" 처리 가능
    if (safeForm.status === TERMINAL_STATUS && evidenceCount(safeForm) < 5) {
      setFormError(
        `"${TERMINAL_STATUS}" 상태로 저장하려면 증거 제출 5가지(요약/결과/검수결과/제안/스크린샷 첨부)를 모두 체크해야 해요.`
      )
      return
    }

    // 같은 제목의 요청이 이미 있으면 중복 등록 실수를 방지하기 위해 한 번 더 확인
    if (isDuplicate(rows, 'request_title', safeForm.request_title, editing?.id)) {
      const ok = await confirm(
        `"${safeForm.request_title.trim()}"과 같은 제목의 요청이 이미 있어요. 그래도 계속 저장할까요?`,
        { confirmLabel: '그래도 저장', danger: false }
      )
      if (!ok) return
    }

    if (editing) await updateRow(editing.id, safeForm)
    else await insertRow(safeForm)
    setModalOpen(false)
  }

  const detailFields = getFieldsForType(form.request_type)

  return (
    <div>
      <PageHeader
        title="루나 요청"
        emoji="🌙"
        description="Luna Creative Studio에 넘긴 이미지·영상 작업 요청 (증거 제출 원칙: '완료했습니다'만으로 종료하지 않음)"
        onAddClick={openAdd}
        addLabel="요청 추가"
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
              <span className="font-semibold">
                {row.request_type && <span className="mr-1.5 text-xs text-ink/40">[{row.request_type}]</span>}
                {row.request_title}
              </span>
              <StatusBadge status={row.status} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink/50">
              <span>{row.department}</span>
              <span>·</span>
              <span>증거 제출 {evidenceCount(row)}/5</span>
              {row.june_reference && (
                <>
                  <span>·</span>
                  <span>🧸 June {row.june_reference.version}</span>
                </>
              )}
            </div>
          </button>
        ))}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? '요청 수정' : '요청 추가'}>
        <form onSubmit={handleSave}>
          <FormField
            label="요청 제목"
            required
            value={form.request_title}
            onChange={(v) => setForm({ ...form, request_title: v })}
          />
          <FormField
            label="요청 종류"
            type="select"
            options={REQUEST_TYPES}
            value={form.request_type}
            onChange={handleTypeChange}
          />
          <FormField
            label="담당 본부"
            type="select"
            options={DEPARTMENT_OPTIONS}
            value={form.department}
            onChange={(v) => setForm({ ...form, department: v })}
          />
          <FormField
            label="상태"
            type="select"
            options={REQUEST_STATUS_FLOW}
            value={form.status}
            onChange={(v) => setForm({ ...form, status: v })}
          />

          {/* 요청 종류(이미지/영상)에 따른 세부 필드 */}
          {detailFields.length > 0 && (
            <div className="my-3 space-y-1 rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-bold text-ink/70">{form.request_type} 요청 세부 정보</p>
                <button
                  type="button"
                  onClick={handleApplyJune}
                  disabled={!activeJune}
                  className="rounded-md border border-stamp-amber/40 px-2 py-1 text-[11px] font-semibold text-stamp-amber hover:bg-stamp-amber/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  🧸 June 공식 기준 포함
                </button>
              </div>
              {!activeJune && (
                <p className="mb-2 text-[11px] text-ink/40">
                  June 캐릭터 관리실에서 공식 버전을 지정하면 여기서 자동으로 반영할 수 있어요.
                </p>
              )}
              {juneMessage && (
                <p
                  className={`mb-2 text-[11px] ${
                    juneMessage.type === 'success' ? 'text-stamp-pass' : 'text-stamp-reject'
                  }`}
                >
                  {juneMessage.text}
                </p>
              )}
              {form.june_reference && (
                <p className="mb-2 text-[11px] text-ink/40">
                  ✓ June {form.june_reference.version} 기준 적용됨 ({new Date(form.june_reference.applied_at).toLocaleString('ko-KR')})
                </p>
              )}
              {detailFields.map((f) => (
                <FormField
                  key={f.key}
                  label={f.label}
                  type={f.type}
                  options={f.options}
                  value={form.details[f.key]}
                  onChange={(v) => setDetail(f.key, v)}
                />
              ))}
            </div>
          )}

          <div className="my-3 space-y-2 rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
            <p className="text-xs font-bold text-ink/70">📋 증거 제출 체크리스트</p>
            <FormField
              type="checkbox"
              label="작업 요약 제출"
              value={form.evidence_summary}
              onChange={(v) => setForm({ ...form, evidence_summary: v })}
            />
            <FormField
              type="checkbox"
              label="작업 결과 제출"
              value={form.evidence_result}
              onChange={(v) => setForm({ ...form, evidence_result: v })}
            />
            <FormField
              type="checkbox"
              label="검수 결과 제출"
              value={form.evidence_review}
              onChange={(v) => setForm({ ...form, evidence_review: v })}
            />
            <FormField
              type="checkbox"
              label="개선/다음 작업 제안 제출"
              value={form.evidence_suggestion}
              onChange={(v) => setForm({ ...form, evidence_suggestion: v })}
            />
            <FormField
              type="checkbox"
              label="스크린샷 첨부 완료"
              value={form.evidence_screenshot}
              disabled={!canCheckEvidence('screenshot', form.attachments)}
              onChange={(v) => setForm({ ...form, evidence_screenshot: v })}
              hint={
                canCheckEvidence('screenshot', form.attachments)
                  ? undefined
                  : '아래에서 "실행 화면 이미지"를 먼저 첨부해야 체크할 수 있어요.'
              }
            />
          </div>

          <div className="my-3">
            <p className="mb-2 text-xs font-bold text-ink/70">📎 증거 파일 첨부</p>
            <AttachmentSection
              attachments={form.attachments}
              onChange={(next) => setForm({ ...form, attachments: next })}
            />
          </div>

          <FormField label="메모" type="textarea" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />

          {formError && <p className="mb-2 text-xs text-stamp-reject">{formError}</p>}

          <div className="mt-4 flex items-center justify-between">
            {editing && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirm('이 요청을 삭제할까요? 휴지통으로 이동해요.')
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
