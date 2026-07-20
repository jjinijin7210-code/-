// ============================================================
// 네이버 쇼핑(클립 포함) 상품 검색 - 네이버 공식 검색 오픈API 사용
// (1688처럼 스크래핑이 아니라 공식 API라, 결과에 실제 구매 링크가 바로 포함되어 있어서
// 1688→쿠팡처럼 "소싱 후 별도로 실제 판매처 확인"하는 단계가 필요 없음)
// 발급: https://developers.naver.com/apps/#/register (네이버 로그인만 있으면 무료)
// ============================================================

const NAVER_SEARCH_URL = 'https://openapi.naver.com/v1/search/shop.json'

function stripTags(text) {
  return String(text || '').replace(/<\/?b>/g, '').replace(/&amp;/g, '&')
}

export async function searchNaverShoppingProducts({ query, display = 20, sort = 'sim' }) {
  if (!query) {
    throw new Error('검색어(query)가 필요해요.')
  }
  const clientId = process.env.NAVER_CLIENT_ID
  const clientSecret = process.env.NAVER_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('NAVER_CLIENT_ID/NAVER_CLIENT_SECRET이 서버 .env에 설정되어 있지 않아요.')
  }

  const params = new URLSearchParams({ query, display: String(display), sort })
  const res = await fetch(`${NAVER_SEARCH_URL}?${params.toString()}`, {
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`네이버 쇼핑 검색 오류 (${res.status}): ${errText.slice(0, 300)}`)
  }

  const data = await res.json()
  return (data.items || []).map((item) => ({
    title: stripTags(item.title),
    price: item.lprice ? Number(item.lprice) : null,
    image: item.image,
    productUrl: item.link,
    mallName: item.mallName,
    brand: item.brand || item.maker || null,
  }))
}
