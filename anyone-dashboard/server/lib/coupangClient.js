// ============================================================
// 쿠팡 상품 검색 - Apify Actor 결과를 대시보드에서 쓰기 좋은 형태로 정리
// 1688에서 소싱한 상품이 실제로 쿠팡에도 있는지 확인하는 용도 (없으면 초안 자체를 만들지 않음)
// ============================================================

import { runApifyActor } from './apifyClient.js'

const ACTOR_COUPANG = 'amit123~coupang-products-crawler'

export async function searchCoupangProducts({ query, maxPagesPerQuery = 1 }) {
  if (!query) {
    throw new Error('검색어(query)가 필요해요.')
  }

  const items = await runApifyActor(ACTOR_COUPANG, {
    searchQueries: [query],
    maxPagesPerQuery,
  })

  return (items || [])
    .filter((item) => item.is_available !== false && !item.is_sold_out)
    .map((item) => ({
      title: item.title,
      brand: item.brand,
      price: item.sales_price,
      thumbnail: item.thumbnail,
      productUrl: item.product_url,
      ratingAvg: item.rating_avg,
      ratingCount: item.rating_count,
    }))
}
