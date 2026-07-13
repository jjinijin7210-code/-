// ============================================================
// 이중 검수 / 교차 검수 강제 워크플로 (계획서 3장)
//
// 순서: 담당자 작업 완료 → 내부 QA → 브랜드 검수 → 루나 최종 검수 → 애니 교차 검수 → 진희 최종 승인 → 완료
//
// 규칙:
// 1. 앞 단계가 "통과"되지 않으면 다음 단계로 진행할 수 없음
// 2. 작업자 본인(assignee)은 자신의 작업을 검수/승인할 수 없음 (모든 단계 공통)
// 3. 각 단계마다 담당자, 일시, 결과, 의견, 반려 사유, 수정 내역을 기록
//
// 순수 함수로 작성해서 React 컴포넌트 없이도 Node.js에서 그대로 테스트할 수 있습니다.
// (테스트: scripts/test-qa-workflow.mjs)
// ============================================================

// "담당자 작업 완료" 다음에 거쳐야 하는 5개의 검수 관문
export const REVIEW_STAGES = ['내부 QA', '브랜드 검수', '루나 최종 검수', '애니 교차 검수', '진희 최종 승인']

export function nowIso() {
  return new Date().toISOString()
}

// 지금 이 항목이 다음으로 통과해야 할 단계 이름 (모두 통과했으면 null)
export function getNextStage(item) {
  const idx = item.current_stage ?? 0
  if (idx >= REVIEW_STAGES.length) return null
  return REVIEW_STAGES[idx]
}

export function isComplete(item) {
  return (item.current_stage ?? 0) >= REVIEW_STAGES.length
}

/**
 * 검수 결과를 제출합니다. 실패하면 에러를 던집니다(화면에서 그대로 메시지로 보여주면 됨).
 *
 * @param {object} item - { assignee, current_stage, status }
 * @param {object} input - { reviewer, result('통과'|'반려'), comment, rejectReason, revisionNote }
 * @returns {{ updatedItem: object, step: object }}
 */
export function submitReview(item, input) {
  const { reviewer, result, comment, rejectReason, revisionNote } = input

  if (isComplete(item)) {
    throw new Error('이미 모든 검수 단계를 통과한 항목이에요.')
  }
  if (!reviewer || !reviewer.trim()) {
    throw new Error('검수자 이름을 입력해야 해요.')
  }
  // 규칙 2: 본인 작업 자기 승인 금지 (모든 단계 공통)
  if (item.assignee && reviewer.trim().toLowerCase() === item.assignee.trim().toLowerCase()) {
    throw new Error('작업자 본인은 자신의 작업을 검수·승인할 수 없어요. 다른 담당자를 지정해주세요.')
  }
  if (result !== '통과' && result !== '반려') {
    throw new Error('검수 결과는 통과 또는 반려여야 해요.')
  }
  if (result === '반려' && (!rejectReason || !rejectReason.trim())) {
    throw new Error('반려할 때는 반려 사유를 반드시 입력해야 해요.')
  }

  const stage = getNextStage(item)
  const step = {
    stage,
    reviewer: reviewer.trim(),
    result,
    comment: comment || '',
    reject_reason: result === '반려' ? rejectReason.trim() : '',
    revision_note: revisionNote || '',
    reviewed_at: nowIso(),
  }

  let updatedItem
  if (result === '통과') {
    const nextStageIndex = (item.current_stage ?? 0) + 1
    const complete = nextStageIndex >= REVIEW_STAGES.length
    updatedItem = {
      ...item,
      current_stage: nextStageIndex,
      status: complete ? '완료' : '진행중',
    }
  } else {
    // 반려 - 같은 단계에 머무름. 담당자가 수정 후 같은 단계를 다시 통과해야 진행 가능
    updatedItem = {
      ...item,
      status: '반려',
    }
  }

  return { updatedItem, step }
}

// 이미 기록된 검수 이력(steps)을 보고, 정말로 순서대로 진행됐는지 검증하는 헬퍼
// (데이터가 실제로 규칙을 지키며 쌓였는지 사후 점검용 - 테스트에서 사용)
export function validateStepOrder(steps) {
  let passedCount = 0
  for (const step of steps) {
    const expectedStage = REVIEW_STAGES[passedCount]
    if (step.result === '통과') {
      if (step.stage !== expectedStage) {
        return { ok: false, error: `${step.stage} 단계가 예상 순서(${expectedStage})를 건너뛰었어요.` }
      }
      passedCount += 1
    } else if (step.result === '반려') {
      if (step.stage !== expectedStage) {
        return { ok: false, error: `반려 기록의 단계(${step.stage})가 현재 진행 단계(${expectedStage})와 달라요.` }
      }
    }
  }
  return { ok: true, passedCount }
}
