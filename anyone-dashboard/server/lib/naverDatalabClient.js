// ============================================================
// 네이버 데이터랩 검색어트렌드 API - 블로그 글별 "좋아요(공감)" 수는 네이버가 공식으로
// 안 줘서, 대신 어떤 주제를 사람들이 실제로 많이 검색하는지(=관심도)로 트렌드를 판단한다.
// 공식/무료 API (네이버 클라우드 플랫폼 "NAVER API HUB"에서 앱 등록 + 검색어트렌드 API 신청 필요).
//
// 2026-07-31: 네이버가 예전 openapi.naver.com 방식(X-Naver-Client-Id/Secret)의 개인 오픈API를
// "NAVER API HUB"(네이버 클라우드 플랫폼 NCP 기반)로 이전함 - URL도, 인증 헤더 이름도 바뀜.
// 진희님이 실제 API HUB 가이드 문서에서 발급받은 요청 예시(curl)를 확인해서 반영함:
// https://naverapihub.apigw.ntruss.com/search-trend/v1/search
// 헤더: X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY (요청 바디·응답 형식은 예전과 동일함 확인됨)
// ============================================================

const DATALAB_URL = 'https://naverapihub.apigw.ntruss.com/search-trend/v1/search'

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
      'X-NCP-APIGW-API-KEY-ID': clientId,
      'X-NCP-APIGW-API-KEY': clientSecret,
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

// 2026-07-31: "쇼핑인사이트도 미리 만들어두자" 요청 - 나중에 1688 소싱/쇼핑쇼츠 기획실에
// "요즘 뜨는 쇼핑 카테고리" 기능 만들 때 쓸 용도로 지금은 아무 곳에서도 안 부르는 미사용 함수로
// 미리 준비만 해둠 (compareSearchTrend와 같은 인증/URL 패턴, NAVER API HUB로 이전됨).
const SHOPPING_CATEGORY_URL = 'https://naverapihub.apigw.ntruss.com/shopping/v1/categories'

// categories: [{ name: '패션의류', param: ['50000000'] }, ...] - param은 네이버쇼핑 카테고리 코드
// (검색 URL의 cat_id 값). 최근 N일간 해당 카테고리들의 클릭 추이 평균이 가장 높은 카테고리를 찾음.
export async function compareShoppingCategoryTrend(categories, { days = 30, device, gender, ages } = {}) {
  const clientId = process.env.NAVER_CLIENT_ID
  const clientSecret = process.env.NAVER_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('NAVER_CLIENT_ID/NAVER_CLIENT_SECRET이 서버 .env에 설정되어 있지 않아요.')
  }
  if (!categories.length) {
    throw new Error('category는 1개 이상이어야 해요.')
  }

  const endDate = new Date()
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000)
  const fmt = (d) => d.toISOString().slice(0, 10)

  const body = {
    startDate: fmt(startDate),
    endDate: fmt(endDate),
    timeUnit: 'date',
    category: categories.map((c) => ({ name: c.name, param: c.param })),
  }
  if (device) body.device = device
  if (gender) body.gender = gender
  if (ages) body.ages = ages

  const res = await fetch(SHOPPING_CATEGORY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-NCP-APIGW-API-KEY-ID': clientId,
      'X-NCP-APIGW-API-KEY': clientSecret,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`네이버 쇼핑인사이트 오류 (${res.status}): ${errText.slice(0, 300)}`)
  }
  const data = await res.json()

  return (data.results || [])
    .map((r) => {
      const values = (r.data || []).map((d) => d.ratio)
      const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
      return { label: r.title, avgRatio: avg }
    })
    .sort((a, b) => b.avgRatio - a.avgRatio)
}
