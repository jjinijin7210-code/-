// qaWorkflow.js의 검수 강제 규칙을 Node.js에서 실제로 실행해서 검증하는 테스트.
// 실행: node scripts/test-qa-workflow.mjs

import assert from 'node:assert/strict'
import { REVIEW_STAGES, getNextStage, isComplete, submitReview, validateStepOrder } from '../src/lib/qaWorkflow.js'

let passed = 0
function check(name, fn) {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (e) {
    console.log(`  ❌ ${name}`)
    console.log(`     -> ${e.message}`)
    process.exitCode = 1
  }
}

function assertThrows(fn, messageIncludes) {
  let threw = false
  try {
    fn()
  } catch (e) {
    threw = true
    assert.ok(e.message.includes(messageIncludes), `에러 메시지에 "${messageIncludes}"가 포함되어야 함 (실제: ${e.message})`)
  }
  assert.ok(threw, '에러가 발생했어야 하는데 발생하지 않음')
}

console.log('=== 1. 검수 순서(5단계) 기본 확인 ===')
check('REVIEW_STAGES는 요청하신 5단계 그대로', () => {
  assert.deepEqual(REVIEW_STAGES, ['내부 QA', '브랜드 검수', '루나 최종 검수', '애니 교차 검수', '진희 최종 승인'])
})

console.log('=== 2. 자기 승인 금지 ===')
{
  const item = { assignee: '캐릭터 디자이너', current_stage: 0, status: '진행중' }
  check('작업자 본인이 검수자로 시도하면 에러 발생', () => {
    assertThrows(
      () => submitReview(item, { reviewer: '캐릭터 디자이너', result: '통과' }),
      '자신의 작업을 검수'
    )
  })
  check('이름 앞뒤 공백/대소문자가 달라도 본인으로 인식해서 차단', () => {
    assertThrows(
      () => submitReview(item, { reviewer: '  캐릭터 디자이너  ', result: '통과' }),
      '자신의 작업을 검수'
    )
  })
  check('다른 사람이면 정상적으로 검수 제출 가능', () => {
    const { updatedItem } = submitReview(item, { reviewer: '품질관리 책임자', result: '통과' })
    assert.equal(updatedItem.current_stage, 1)
  })
}

console.log('=== 3. 순서 강제 (앞 단계 통과 없이 다음 단계 진행 불가) ===')
{
  let item = { assignee: '영상 감독', current_stage: 0, status: '진행중' }

  check('처음 제출하는 검수는 자동으로 "내부 QA" 단계로 기록됨 (건너뛸 방법이 없음)', () => {
    const { step, updatedItem } = submitReview(item, { reviewer: '디자인 QA', result: '통과' })
    assert.equal(step.stage, '내부 QA')
    item = updatedItem
    assert.equal(item.current_stage, 1)
  })

  check('다음 제출은 자동으로 "브랜드 검수" 단계로 기록됨', () => {
    const { step, updatedItem } = submitReview(item, { reviewer: '브랜드 매니저', result: '통과' })
    assert.equal(step.stage, '브랜드 검수')
    item = updatedItem
  })

  check('전체 5단계를 순서대로 통과하면 최종적으로 상태가 "완료"가 됨', () => {
    ;({ updatedItem: item } = submitReview(item, { reviewer: '루나', result: '통과' }))
    ;({ updatedItem: item } = submitReview(item, { reviewer: '애니 담당자', result: '통과' }))
    ;({ updatedItem: item } = submitReview(item, { reviewer: '진희', result: '통과' }))
    assert.equal(item.status, '완료')
    assert.equal(isComplete(item), true)
    assert.equal(getNextStage(item), null)
  })

  check('완료된 항목에 다시 검수를 제출하려 하면 에러', () => {
    assertThrows(() => submitReview(item, { reviewer: '아무개', result: '통과' }), '이미 모든 검수 단계를 통과')
  })
}

console.log('=== 4. 반려 시 같은 단계에 머무름 + 반려 사유 필수 ===')
{
  let item = { assignee: '카피라이터', current_stage: 0, status: '진행중' }

  check('반려 사유 없이 반려하려 하면 에러', () => {
    assertThrows(() => submitReview(item, { reviewer: '품질관리 책임자', result: '반려' }), '반려 사유')
  })

  check('반려하면 current_stage가 그대로 유지되고 status가 "반려"가 됨', () => {
    const { updatedItem, step } = submitReview(item, {
      reviewer: '품질관리 책임자',
      result: '반려',
      rejectReason: '문구에 오탈자 다수',
    })
    assert.equal(updatedItem.current_stage, 0) // 그대로
    assert.equal(updatedItem.status, '반려')
    assert.equal(step.stage, '내부 QA')
    assert.equal(step.reject_reason, '문구에 오탈자 다수')
    item = updatedItem
  })

  check('수정 후 같은 단계를 다시 제출해서 통과하면 다음 단계로 진행됨 (수정 내역 기록)', () => {
    const { updatedItem, step } = submitReview(item, {
      reviewer: '품질관리 책임자',
      result: '통과',
      revisionNote: '오탈자 3곳 수정 완료',
    })
    assert.equal(step.stage, '내부 QA') // 같은 단계 재검수
    assert.equal(step.revision_note, '오탈자 3곳 수정 완료')
    assert.equal(updatedItem.current_stage, 1)
    assert.equal(updatedItem.status, '진행중')
  })
}

console.log('=== 5. 검수 이력 순서 검증 헬퍼 ===')
{
  check('정상적으로 순서대로 쌓인 이력은 유효함', () => {
    const steps = [
      { stage: '내부 QA', result: '반려' },
      { stage: '내부 QA', result: '통과' },
      { stage: '브랜드 검수', result: '통과' },
    ]
    const res = validateStepOrder(steps)
    assert.equal(res.ok, true)
    assert.equal(res.passedCount, 2)
  })

  check('단계를 건너뛴 비정상 이력은 잡아냄', () => {
    const steps = [{ stage: '루나 최종 검수', result: '통과' }] // 내부 QA를 건너뜀
    const res = validateStepOrder(steps)
    assert.equal(res.ok, false)
  })
}

console.log(`\n총 ${passed}개 테스트 통과`)
