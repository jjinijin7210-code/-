// ============================================================
// 스레드(Threads) 검색 - 후보 주제들의 실제 좋아요/댓글 반응을 비교해서
// 오늘 어떤 주제가 더 잘 통하는지 확인하는 용도 (threadBlogAuto.js에서 사용).
// 인스타/틱톡 해시태그 검색과 같은 원리지만, 스레드는 해시태그보다 키워드 검색이 더 잘 맞아서
// mode: 'search'를 씀. 한글 키워드는 검색 결과가 거의 안 잡혀서(실측 확인) 영어 키워드로 검색함
// - 실제 생성되는 초안 문장은 이 검색 결과를 베끼는 게 아니라 참고만 하므로 언어가 달라도 무방.
// ============================================================

import { runApifyActor } from './apifyClient.js'

const ACTOR_THREADS = 'automation-lab~threads-scraper'

export async function searchThreadsPosts({ query, maxPosts = 8 }) {
  if (!query) {
    throw new Error('검색어(query)가 필요해요.')
  }

  const items = await runApifyActor(ACTOR_THREADS, {
    mode: 'search',
    searchQueries: [query],
    maxPosts,
    includeProfile: false,
  })

  return (items || [])
    .filter((item) => item.type === 'post')
    .map((item) => ({
      text: item.text,
      likeCount: item.likeCount || 0,
      replyCount: item.replyCount || 0,
      repostCount: item.repostCount || 0,
      url: item.url,
    }))
}

// 후보 주제(topic)마다 검색해서 좋아요+댓글 합산 점수가 가장 높은 걸 오늘의 주제로 고름
export async function pickTrendingTopic(candidates, { maxPostsPerQuery = 8 } = {}) {
  const scored = []
  for (const candidate of candidates) {
    try {
      const posts = await searchThreadsPosts({ query: candidate.searchQuery, maxPosts: maxPostsPerQuery })
      const score = posts.reduce((sum, p) => sum + p.likeCount + p.replyCount, 0)
      scored.push({ ...candidate, score, sampleCount: posts.length })
    } catch (err) {
      console.error(`[threadsSearchClient] "${candidate.searchQuery}" 트렌드 확인 실패:`, err.message)
      scored.push({ ...candidate, score: 0, sampleCount: 0, error: err.message })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  return { picked: scored[0], scored }
}
