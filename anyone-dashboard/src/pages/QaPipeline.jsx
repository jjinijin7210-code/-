import { useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { useConfirm } from '../components/ConfirmDialog'
import SaveStatusIndicator from '../components/SaveStatusIndicator'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import StatusBadge from '../components/StatusBadge'
import { LoadingView, ErrorView, EmptyView } from '../components/StateViews'
import { REVIEW_STAGES, getNextStage, isComplete, submitReview } from '../lib/qaWorkflow'

const DEPARTMENT_OPTIONS = ['아트본부', '영상본부', '콘텐츠본부', '브랜드본부', 'QA본부', '연구소']
const emptyNewForm = { item_name: '', department: DEPARTMENT_OPTIONS[0], assignee: '', note: '' }
const emptyReviewForm = { reviewer: '', result: '통과', comment: '', reject_reason: '', revision_note: '' }

export default function QaPipeline() {
  const {
    rows: items,
    loading,
    error,
    saveStatus,
    insertRow,
    updateRow,
    deleteRow,
  } = useSupabaseTable('qa_pipeline', { orderBy: 'updated_at' })
  const { rows: allSteps, insertRow: insertStep, deleteRow: deleteStep } = useSupabaseTable('qa_review_steps', {
    orderBy: 'reviewed_at',
    ascending: true,
  })
  const confirm = useConfirm()

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState(emptyNewForm)

  const [detailItem, setDetailItem] = useState(null) // 지금 상세보기 중인 항목
  const [reviewForm, setReviewForm] = useState(emptyReviewForm)
  const [reviewError, setReviewError] = useState(null)

  const stepsFor = (pipelineId) => allSteps.filter((s) => s.pipeline_id === pipelineId)

  const openCreate = () => {
    setCreateForm(emptyNewForm)
    setCreateOpen(true)
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!createForm.assignee.trim()) return
    await insertRow({ ...createForm, current_stage: 0, status: '진행중' })
    setCreateOpen(false)
  }

  const openDetail = (item) => {
    setDetailItem(item)
    setReviewForm(emptyReviewForm)
    setReviewError(null)
  }

  const closeDetail = () => setDetailItem(null)

  const handleSubmitReview = async (e) => {
    e.preventDefault()
    setReviewError(null)
    try {
      const { updatedItem, step } = submitReview(detailItem, {
        reviewer: reviewForm.reviewer,
        result: reviewForm.result,
        comment: reviewForm.comment,
        rejectReason: reviewForm.reject_reason,
        revisionNote: reviewForm.revision_note,
      })
      // 검수 이력 저장 (담당자/일시/결과/의견/반려사유/수정내역 전부 기록)
      await insertStep({ ...step, pipeline_id: detailItem.id })
      // 항목 상태(현재 단계) 갱신
      const saved = await updateRow(detailItem.id, {
        current_stage: updatedItem.current_stage,
        status: updatedItem.status,
      })
      setDetailItem(saved ?? { ...detailItem, ...updatedItem })
      setReviewForm(emptyReviewForm)
    } catch (err) {
      // 규칙 위반(자기 승인, 반려 사유 누락 등)은 여기서 사람이 읽을 수 있는 메시지로 표시
      setReviewError(err.message)
    }
  }

  const handleDeleteItem = async () => {
    const ok = await confirm('이 항목과 검수 이력을 모두 삭제할까요?')
    if (!ok) return
    for (const step of stepsFor(detailItem.id)) {
      await deleteStep(step.id)
    }
    await deleteRow(detailItem.id)
    closeDetail()
  }

  return (
    <div>
      <PageHeader
        title="QA 파이프라인"
        emoji="🎨"
        description="담당자 작업 완료 → 내부 QA → 브랜드 검수 → 루나 최종 검수 → 애니 교차 검수 → 진희 최종 승인 → 완료 (앞 단계 통과 없이는 다음 단계 진행 불가, 본인 작업 자기 승인 불가)"
        onAddClick={openCreate}
        addLabel="항목 추가"
      />

      {loading && <LoadingView />}
      {error && <ErrorView message={error} />}
      {!loading && !error && items.length === 0 && <EmptyView />}

      <div className="space-y-2">
        {items.map((item) => {
          const stage = getNextStage(item)
          return (
            <button
              key={item.id}
              onClick={() => openDetail(item)}
              className="block w-full rounded-xl bg-paper-card p-4 text-left shadow-card transition hover:shadow-md"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{item.item_name}</span>
                <StatusBadge status={item.status} />
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink/50">
                <span>{item.department}</span>
                <span>·</span>
                <span>담당: {item.assignee}</span>
                <span>·</span>
                <span>{isComplete(item) ? '전체 5단계 통과' : `다음 단계: ${stage} (${item.current_stage}/5 통과)`}</span>
              </div>
            </button>
          )
        })}
      </div>

      {/* 새 항목 추가 모달 */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="항목 추가">
        <form onSubmit={handleCreate}>
          <FormField
            label="작업명"
            required
            value={createForm.item_name}
            onChange={(v) => setCreateForm({ ...createForm, item_name: v })}
          />
          <FormField
            label="담당 본부"
            type="select"
            options={DEPARTMENT_OPTIONS}
            value={createForm.department}
            onChange={(v) => setCreateForm({ ...createForm, department: v })}
          />
          <FormField
            label="작업 담당자"
            required
            hint="이 사람은 이 항목의 검수자가 될 수 없어요 (자기 승인 금지)"
            value={createForm.assignee}
            onChange={(v) => setCreateForm({ ...createForm, assignee: v })}
          />
          <FormField label="메모" type="textarea" value={createForm.note} onChange={(v) => setCreateForm({ ...createForm, note: v })} />
          <div className="mt-4 flex justify-end">
            <button type="submit" className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90">
              생성
            </button>
          </div>
        </form>
      </Modal>

      {/* 상세보기 + 검수 제출 모달 */}
      <Modal open={!!detailItem} onClose={closeDetail} title={detailItem?.item_name}>
        {detailItem && (
          <div>
            <div className="mb-4 flex flex-wrap gap-2 text-xs text-ink/50">
              <span>{detailItem.department}</span>
              <span>·</span>
              <span>담당: {detailItem.assignee}</span>
              <StatusBadge status={detailItem.status} />
            </div>

            {/* 5단계 진행 표시 */}
            <div className="mb-4 flex flex-wrap gap-1.5">
              {REVIEW_STAGES.map((s, i) => {
                const donePast = i < detailItem.current_stage
                const isNext = i === detailItem.current_stage && !isComplete(detailItem)
                return (
                  <span
                    key={s}
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${
                      donePast
                        ? 'border-stamp-pass text-stamp-pass bg-stamp-pass/5'
                        : isNext
                        ? 'border-stamp-amber text-stamp-amber bg-stamp-amber/10 font-semibold'
                        : 'border-ink/15 text-ink/40'
                    }`}
                  >
                    {donePast ? '✓ ' : ''}
                    {s}
                  </span>
                )
              })}
            </div>

            {/* 검수 이력 */}
            <div className="mb-4 max-h-48 space-y-2 overflow-y-auto rounded-lg border border-ink/10 p-3">
              <p className="text-xs font-bold text-ink/50">검수 이력</p>
              {stepsFor(detailItem.id).length === 0 && <p className="text-xs text-ink/30">아직 검수 기록이 없어요.</p>}
              {stepsFor(detailItem.id).map((s) => (
                <div key={s.id} className="rounded-md bg-ink/[0.03] p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">
                      {s.stage} · {s.reviewer}
                    </span>
                    <StatusBadge status={s.result} />
                  </div>
                  {s.comment && <p className="mt-1 text-ink/60">의견: {s.comment}</p>}
                  {s.reject_reason && <p className="mt-1 text-stamp-reject">반려 사유: {s.reject_reason}</p>}
                  {s.revision_note && <p className="mt-1 text-ink/60">수정 내역: {s.revision_note}</p>}
                  <p className="mt-1 text-ink/30">{new Date(s.reviewed_at).toLocaleString('ko-KR')}</p>
                </div>
              ))}
            </div>

            {/* 다음 검수 제출 폼 (완료된 항목은 숨김) */}
            {!isComplete(detailItem) ? (
              <form onSubmit={handleSubmitReview}>
                <p className="mb-2 text-xs font-bold text-ink/70">
                  다음 검수 제출: {getNextStage(detailItem)}
                </p>
                <FormField
                  label="검수자"
                  required
                  hint={`"${detailItem.assignee}" 본인은 입력할 수 없어요`}
                  value={reviewForm.reviewer}
                  onChange={(v) => setReviewForm({ ...reviewForm, reviewer: v })}
                />
                <FormField
                  label="결과"
                  type="select"
                  options={['통과', '반려']}
                  value={reviewForm.result}
                  onChange={(v) => setReviewForm({ ...reviewForm, result: v })}
                />
                <FormField
                  label="의견"
                  type="textarea"
                  value={reviewForm.comment}
                  onChange={(v) => setReviewForm({ ...reviewForm, comment: v })}
                />
                {reviewForm.result === '반려' && (
                  <FormField
                    label="반려 사유"
                    required
                    type="textarea"
                    value={reviewForm.reject_reason}
                    onChange={(v) => setReviewForm({ ...reviewForm, reject_reason: v })}
                  />
                )}
                {detailItem.status === '반려' && reviewForm.result === '통과' && (
                  <FormField
                    label="수정 내역 (반려 후 재검수라 기록을 남겨두면 좋아요)"
                    type="textarea"
                    value={reviewForm.revision_note}
                    onChange={(v) => setReviewForm({ ...reviewForm, revision_note: v })}
                  />
                )}

                {reviewError && (
                  <p className="mb-2 rounded-md bg-stamp-reject/10 p-2 text-xs text-stamp-reject">{reviewError}</p>
                )}

                <div className="mt-3 flex items-center justify-between">
                  <button type="button" onClick={handleDeleteItem} className="text-sm text-stamp-reject hover:underline">
                    항목 삭제
                  </button>
                  <div className="ml-auto flex items-center gap-3">
                    <SaveStatusIndicator status={saveStatus} />
                    <button type="submit" className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90">
                      검수 제출
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              <div className="flex items-center justify-between">
                <button onClick={handleDeleteItem} className="text-sm text-stamp-reject hover:underline">
                  항목 삭제
                </button>
                <p className="text-sm font-semibold text-stamp-pass">✓ 모든 검수 단계를 통과했어요</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
