// ============================================================
// 상품 소싱 사이트(1688 등) 검색 - Apify Actor 결과를 대시보드에서 쓰기 좋은 형태로 정리
// ============================================================

import { runApifyActor } from './apifyClient.js'

const ACTOR_1688 = 'devcake~1688-com-products-scraper'

export async function search1688Products({ query, maxProducts = 20, sortType = 'va_rmdarkgmv30' }) {
  if (!query) {
    throw new Error('검색어(query)가 필요해요.')
  }

  const items = await runApifyActor(ACTOR_1688, {
    queries: [query],
    maxProducts,
    sortType,
  })

  return (items || []).map((item) => ({
    title: item.title,
    price: item.price,
    imageUrl: item.image_url,
    orderCount: item.order_count,
    repurchaseRate: item.repurchase_rate,
    shopName: item.shop_name,
    quantityPrices: item.quantity_prices,
    score: item.composite_score,
    detailUrl: item.detail_url,
  }))
}
