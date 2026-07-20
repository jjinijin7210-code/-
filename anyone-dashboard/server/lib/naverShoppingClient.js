// ============================================================
// 네이버 쇼핑(스마트스토어) 상품 검색 - Apify Actor 사용
// 원래는 네이버 공식 검색 API(쇼핑)를 쓰려고 했으나, 네이버가 2026-07-31부로 쇼핑/책/전문자료
// 검색 API를 이관 없이 완전 종료한다고 공지해서(대체 API 없음) 1688/쿠팡과 동일한 방식인
// Apify 스크래핑으로 전환 (기존 APIFY_TOKEN 그대로 재사용, 새 키 발급 불필요).
// 실측 확인(2026-07-20): 액터 설명은 영어 키워드를 권장하지만 한글 키워드로도 정상 동작함.
// ============================================================

import { runApifyActor } from './apifyClient.js'

const ACTOR_NAVER_SHOPPING = 'delicious_zebu~naver-shopping-product-scraper'

export async function searchNaverShoppingProducts({ query, maxCrawlPages = 1 }) {
  if (!query) {
    throw new Error('검색어(query)가 필요해요.')
  }

  const items = await runApifyActor(ACTOR_NAVER_SHOPPING, {
    keywords: [query],
    maxCrawlPages,
  })

  return (items || []).map((item) => ({
    title: item.productName,
    price: item.discountedPrice ?? item.originalPrice ?? null,
    image: item.productImageUrl,
    productUrl: item.productPageUrl,
    mallName: item.sellerName,
    brand: item.isBrandStore ? item.sellerName : null,
    rating: item.averageRating,
    reviewCount: item.totalReviews,
  }))
}
