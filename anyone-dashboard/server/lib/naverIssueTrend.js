// ============================================================
// 2026-07-31 요청: "방송연예/패션뷰티/스포츠/경제 중 그 기간에 이슈가 되는 걸 위주로 만들면
// 좋을 것 같아" - 네이버 크리에이터 어드바이저(개인 로그인 필요, 자동화 불가)의 "인기 카테고리"
// 기능을 대신할 수 있는 공식 API 조합.
// 1) 네이버 데이터랩 검색어트렌드(naverDatalabClient.js)로 4개 카테고리의 상대 검색량을 비교해
//    요즘 제일 핫한 카테고리를 고름.
// 2) 그 카테고리로 네이버 뉴스검색 API를 호출해 실제 최신 헤드라인(진짜 이슈)을 가져옴.
// 둘 다 NAVER_CLIENT_ID/SECRET(무료, 네이버 개발자센터 앱 등록 필요)이 있어야 동작하고,
// 없거나 실패하면 null을 돌려줘서 상위(threadBlogAuto.js)가 고정 주제 풀로 대체하게 함
// (weatherNote/trendNote.js와 동일 원칙 - 이 기능이 없다고 콘텐츠 생성 자체를 막지 않음).
// ============================================================

import { compareSearchTrend } from './naverDatalabClient.js'

// 2026-07-31: naverDatalabClient.js와 같은 이유(NAVER API HUB로 이전) - 진희님이 실제 API HUB
// 가이드 문서에서 확인한 뉴스검색 요청 예시(curl) 반영함:
// https://naverapihub.apigw.ntruss.com/search/v1/news
// 헤더: X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY
const NEWS_SEARCH_URL = 'https://naverapihub.apigw.ntruss.com/search/v1/news'
// 2026-07-31: 지금 당장 쓰는 곳은 없지만(진희님이 미리 확인해준 요청 예시), 나중에 "이 주제로
// 이미 어떤 네이버 블로그 글이 올라와 있나" 같은 경쟁 블로그 리서치 기능에 바로 쓸 수 있게
// 같은 패턴으로 미리 만들어둠.
const BLOG_SEARCH_URL = 'https://naverapihub.apigw.ntruss.com/search/v1/blog'

export const ISSUE_CATEGORIES = ['방송연예', '패션뷰티', '스포츠', '경제']

// 4개 카테고리 중 최근 3일간 검색량이 가장 높은 카테고리 하나를 돌려줌. 실패/키없음이면 null.
export async function pickHotIssueCategory() {
  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) return null
  try {
    const ranked = await compareSearchTrend(
      ISSUE_CATEGORIES.map((label) => ({ label, keywords: [label] })),
      { days: 3 }
    )
    return ranked[0]?.label || null
  } catch (err) {
    console.error('[naverIssueTrend] 카테고리 트렌드 비교 실패:', err.message)
    return null
  }
}

function stripNaverMarkup(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

// 해당 카테고리 키워드로 가장 최신 뉴스 헤드라인 하나를 가져옴. 실패/키없음/결과없음이면 null.
export async function fetchRecentNewsHeadline(category) {
  const clientId = process.env.NAVER_CLIENT_ID
  const clientSecret = process.env.NAVER_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  try {
    const res = await fetch(`${NEWS_SEARCH_URL}?query=${encodeURIComponent(category)}&display=10&start=1&sort=date&format=json`, {
      headers: { 'X-NCP-APIGW-API-KEY-ID': clientId, 'X-NCP-APIGW-API-KEY': clientSecret },
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`네이버 뉴스검색 오류 (${res.status}): ${errText.slice(0, 300)}`)
    }
    const data = await res.json()
    const items = data.items || []
    if (!items.length) return null
    const top = items[0]
    return {
      title: stripNaverMarkup(top.title),
      description: stripNaverMarkup(top.description),
      link: top.originallink || top.link || '',
      pubDate: top.pubDate || '',
    }
  } catch (err) {
    console.error('[naverIssueTrend] 뉴스 헤드라인 조회 실패:', err.message)
    return null
  }
}

// 해당 검색어로 네이버 블로그 검색 결과를 가져옴(최신순, 최대 display개). 실패/키없음이면 빈 배열.
// (현재 미사용 - 나중에 경쟁 블로그 리서치 기능에서 쓸 용도로 미리 만들어둠)
export async function searchNaverBlog(query, { display = 10 } = {}) {
  const clientId = process.env.NAVER_CLIENT_ID
  const clientSecret = process.env.NAVER_CLIENT_SECRET
  if (!clientId || !clientSecret) return []
  try {
    const res = await fetch(`${BLOG_SEARCH_URL}?query=${encodeURIComponent(query)}&display=${display}&start=1&sort=date&format=json`, {
      headers: { 'X-NCP-APIGW-API-KEY-ID': clientId, 'X-NCP-APIGW-API-KEY': clientSecret },
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`네이버 블로그검색 오류 (${res.status}): ${errText.slice(0, 300)}`)
    }
    const data = await res.json()
    return (data.items || []).map((item) => ({
      title: stripNaverMarkup(item.title),
      description: stripNaverMarkup(item.description),
      link: item.link || '',
      bloggerName: item.bloggername || '',
      postDate: item.postdate || '',
    }))
  } catch (err) {
    console.error('[naverIssueTrend] 블로그 검색 실패:', err.message)
    return []
  }
}
