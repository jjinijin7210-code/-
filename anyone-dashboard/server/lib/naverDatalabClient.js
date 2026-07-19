// ============================================================
// 네이버 데이터랩 검색어트렌드 API - 블로그 글별 "좋아요(공감)" 수는 네이버가 공식으로
// 안 줘서, 대신 어떤 주제를 사람들이 실제로 많이 검색하는지(=관심도)로 트렌드를 판단한다.
// 공식/무료 API (네이버 개발자센터에서 앱 등록 + 데이터랩 API 사용 신청 필요).
// https://developers.naver.com/docs/serviceapi/datalab/search/search.md
// ============================================================

const DATALAB_URL = 'https://openapi.naver.com/v1/datalab/search'

// keywordGroups: [{ label: '여행', keywords: ['국내여행', '해외여행'] }, ...] (최대 5그룹)
// 최근 N일간의 상대 검색량 평균이 가장 높은 그룹을 찾기 위함.
export async function compareSearchTrend(keywordGroups, { days = 7 } = {}) {
  const clientId = process.env.NAVER_CLIENT_ID
  const clientSecret = process.env.NAVER_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('NAVER_CLIENT_ID/NAVER_CLIENT_SECRET이 서버 .env에 설정되어 있지 않아요.')
  }
  if (!keywordGroups.length || keywordGroups.length > 5) {
    throw new Error('keywordGroups는 1~5개여야 해요 (네이버 데이터랩 API 제한).')
  }

  const endDate = new Date()
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000)
  const fmt = (d) => d.toISOString().slice(0, 10)

  const res = await fetch(DATALAB_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
    body: JSON.stringify({
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      timeUnit: 'date',
      keywordGroups: keywordGroups.map((g) => ({ groupName: g.label, keywords: g.keywords })),
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`네이버 데이터랩 오류 (${res.status}): ${errText.slice(0, 300)}`)
  }
  const data = await res.json()

  // results[].data[]는 날짜별 상대 검색량(0~100) - 최근 구간 평균으로 그룹 순위를 매김
  return (data.results || [])
    .map((r) => {
      const values = (r.data || []).map((d) => d.ratio)
      const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
      return { label: r.title, avgRatio: avg }
    })
    .sort((a, b) => b.avgRatio - a.avgRatio)
}
