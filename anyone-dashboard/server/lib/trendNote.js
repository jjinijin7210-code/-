// ============================================================
// "유튜브 트렌드 분석" 탭(youtubeTrend.js)이 이미 만들어서 youtube_trend_report 테이블에
// 저장해둔 AI 리포트를, 초안 생성(draft.js) 프롬프트에 best-effort로 얹기 위한 조회 헬퍼.
// weatherClient.js와 동일한 원칙 - 실패/데이터없음이면 null을 돌려주고 상위에서 무시함
// (트렌드 리포트가 없다고 초안 생성 자체를 막으면 안 됨).
// ============================================================

import { getSupabaseAdmin } from './supabaseAdmin.js'

const MAX_LEN = 600

/**
 * 가장 최근 유튜브 트렌드 리포트를 짧게 잘라 돌려준다. 실패하면 null.
 * @param {object} [opts]
 * @param {string} [opts.genre] - 지정하면 해당 장르 리포트만, 없으면 가장 최근 아무 리포트나
 */
export async function getLatestTrendNote({ genre } = {}) {
  try {
    const supabase = getSupabaseAdmin()
    let query = supabase
      .from('youtube_trend_report')
      .select('genre, report, created_at')
      .not('report', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
    if (genre) query = query.eq('genre', genre)

    const { data, error } = await query
    if (error || !data || !data.length) return null

    const row = data[0]
    const report = (row.report || '').trim()
    if (!report) return null

    const truncated = report.length > MAX_LEN ? `${report.slice(0, MAX_LEN)}...` : report
    return `[${row.genre}] ${truncated}`
  } catch (err) {
    console.error('[trendNote] 트렌드 리포트 조회 실패, 트렌드 반영 없이 진행:', err.message)
    return null
  }
}
