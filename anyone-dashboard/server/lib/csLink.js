// ============================================================
// CS 트리거 키워드 ↔ 인포크 링크 매핑 - auto.js(1688)와 benchmark.js(일본 벤치마킹)가 공유
// ============================================================

export const CS_TRIGGER_KEYWORD = '정보'
export const CS_TARGET_URL = 'https://link.inpock.co.kr/jena10'

// user_id + trigger_keyword로 기존 cs_links 행을 찾고, 없으면 새로 만든다.
export async function ensureCsLink(supabase, targetUserId) {
  const { data: existing } = await supabase
    .from('cs_links')
    .select('id')
    .eq('user_id', targetUserId)
    .eq('trigger_keyword', CS_TRIGGER_KEYWORD)
    .maybeSingle()
  if (existing) return existing.id

  const { data: created, error } = await supabase
    .from('cs_links')
    .insert({ user_id: targetUserId, trigger_keyword: CS_TRIGGER_KEYWORD, target_url: CS_TARGET_URL })
    .select('id')
    .single()
  if (error) throw new Error(`CS 링크 생성 실패: ${error.message}`)
  return created.id
}
