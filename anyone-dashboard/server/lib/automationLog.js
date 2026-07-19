// ============================================================
// 자동 파이프라인 실행 이력 - automation_runs 테이블에 기록해서
// "실행됐는지/성공했는지/왜 실패했는지"를 대시보드에서 바로 확인할 수 있게 한다.
// ============================================================

export async function startAutomationRun(supabase, userId, runType, retry = {}) {
  const { endpoint, payload } = retry
  const { data, error } = await supabase
    .from('automation_runs')
    .insert({ user_id: userId, run_type: runType, status: '진행중', endpoint: endpoint || null, payload: payload || null })
    .select()
    .single()
  if (error) {
    console.error('[automationLog] 실행 로그 시작 실패:', error.message)
    return null
  }
  return data
}

export async function finishAutomationRun(supabase, runId, { status, summary, errorMessage, draftId }) {
  if (!runId) return
  const { error } = await supabase
    .from('automation_runs')
    .update({
      status,
      summary: summary || null,
      error_message: errorMessage || null,
      draft_id: draftId || null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', runId)
  if (error) console.error('[automationLog] 실행 로그 종료 실패:', error.message)
}
