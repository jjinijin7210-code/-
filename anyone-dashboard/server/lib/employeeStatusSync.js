// ============================================================
// 자동 파이프라인 진행 상황을 "직원 현황" 화면에 실시간 반영.
// role_name으로 기존 행을 찾아 상태만 갱신 - 행이 없으면(아직 시딩 안 됨) 조용히 넘어간다.
// ============================================================

export async function setEmployeeStatus(supabase, userId, roleName, status, currentTask) {
  const { error } = await supabase
    .from('employee_status')
    .update({ status, current_task: currentTask || null })
    .eq('user_id', userId)
    .eq('role_name', roleName)
  if (error) console.error(`[employeeStatusSync] "${roleName}" 상태 갱신 실패:`, error.message)
}
