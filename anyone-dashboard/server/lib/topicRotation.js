// ============================================================
// 콘텐츠 소재 반복 방지 공통 헬퍼 (2026-07-26 사용자 보고: "애니원에 나오는 내용들이 계속
// 반복된 것만 나온다" - 콘텐츠 관리 초안이 계속 비슷한 걸로 나온다는 피드백).
//
// 원인 2가지를 같이 잡음:
// 1) 각 파이프라인의 소재 후보 풀이 작고, 랜덤 뽑기에 "최근에 이미 썼는지" 기억이 없었음
//    -> pickAvoidingRecent()로 최근에 실제로 쓰인 값은 최대한 피해서 뽑음 (풀 전체가 이미
//       다 최근에 쓰였으면 어쩔 수 없이 전체 풀에서 다시 뽑음 - 소재 자체가 바닥나서 완전히
//       멈추는 것보단 나음).
// 2) 어느 파이프라인도 새 글 쓰기 전에 "최근에 뭘 만들었는지"를 content_drafts에서 확인 안 함
//    -> getRecentDraftTitles()로 최근 제목 목록을 뽑아서 AI 프롬프트에 "이거랑 안 겹치게 새로
//       써줘"라고 직접 지시할 수 있게 함 (풀 크기와 무관하게, 참고자료 자체가 겹쳐도 AI가
//       다른 각도로 쓰도록 유도하는 마지막 방어선).
//
// 스키마 변경 없이(마이그레이션 없이) 기존 content_drafts 테이블만 조회해서 동작하도록
// 설계함 - 진희님이 Supabase SQL Editor를 따로 열 필요 없게.
// ============================================================

// pool 안에서 최근에 실제로 쓰인 값(recentValues)은 최대한 피해서 무작위로 하나 고름.
// pool 전체가 이미 recentValues에 다 들어있으면(소재가 완전히 바닥남) 어쩔 수 없이 pool
// 전체에서 다시 고름 - 아예 멈추는 것보단 나음.
export function pickAvoidingRecent(pool, recentValues) {
  const recentSet = new Set(recentValues)
  const fresh = pool.filter((item) => !recentSet.has(item))
  const candidates = fresh.length > 0 ? fresh : pool
  return candidates[Math.floor(Math.random() * candidates.length)]
}

// 최근 N일 안에 이 플랫폼(+선택적으로 카테고리)으로 실제로 저장된 초안 제목 목록.
// AI 프롬프트에 "이 제목들과 겹치지 않게 써줘"로 바로 넣어서 쓰는 용도.
export async function getRecentDraftTitles(supabase, userId, { platform, category, limit = 8, sinceDays = 21 } = {}) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString()
  let query = supabase
    .from('content_drafts')
    .select('title, created_at')
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (platform) query = query.eq('platform', platform)
  if (category) query = query.eq('category', category)
  const { data, error } = await query
  if (error || !data) return []
  return data.map((d) => d.title).filter(Boolean)
}

// content_drafts.source 텍스트 안에서 "주제: xxx" 또는 "참고: xxx" 같은 표식으로 심어둔 값을
// 뽑아내서, 다음 실행 때 같은 값을 pickAvoidingRecent()의 recentValues로 넘길 수 있게 함.
// (풀 아이템 원문이 AI가 새로 쓴 제목과는 다르므로, title이 아니라 source에 심어둔 원본
// 풀 값을 그대로 다시 추출해야 정확히 걸러짐.)
export async function getRecentSourceTags(supabase, userId, { platform, marker, limit = 15, sinceDays = 21 } = {}) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString()
  let query = supabase
    .from('content_drafts')
    .select('source, created_at')
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (platform) query = query.eq('platform', platform)
  const { data, error } = await query
  if (error || !data) return []
  const pattern = new RegExp(`${marker}:\\s*([^)/\\n]+)`)
  return data.map((d) => d.source?.match(pattern)?.[1]?.trim()).filter(Boolean)
}
