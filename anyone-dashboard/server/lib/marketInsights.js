// ============================================================
// 국가별 비교 분석(marketAnalysis.js가 만든 텍스트)을 저장/조회 - benchmark_reports 테이블에
// 전용 카테고리로 넣어두고, 전 채널(인스타틱톡/스레드블로그/유튜브) 콘텐츠 생성 시
// 참고자료(referenceNote)에 같이 실어준다.
// ============================================================

export const MARKET_INSIGHT_CATEGORY = '크로스마켓 비교'

export async function saveMarketInsight(supabase, userId, note) {
  return supabase.from('benchmark_reports').insert({
    user_id: userId,
    keyword: '미국·일본 포맷/썸네일 비교 분석',
    platform: '유튜브',
    source_type: '공식 API',
    category: MARKET_INSIGHT_CATEGORY,
    note,
  })
}

export async function getLatestMarketInsight(supabase, userId) {
  const { data } = await supabase
    .from('benchmark_reports')
    .select('note')
    .eq('user_id', userId)
    .eq('category', MARKET_INSIGHT_CATEGORY)
    .order('collected_at', { ascending: false })
    .limit(1)
  return data?.[0]?.note || null
}
