// ============================================================
// 레딧 공개 검색(비로그인) - 심리학 영상에 넣을 "실제 사람들의 고민 사연" 소재를 찾기 위한 용도.
// 레딧 공식 API는 최근 정책 변경으로 대량 접근엔 OAuth가 필요해졌지만, reddit.com의 공개
// .json 엔드포인트는 비로그인 상태로도 소량 요청은 여전히 열려 있는 경우가 많음 - User-Agent를
// 반드시 구체적으로 넣어야 차단(429)을 덜 받는다는 게 알려진 방식이라 그렇게 맞춰뒀다.
// 주의: 이 프로젝트가 만들어진 개발 환경은 네트워크가 막혀 있어 실제 호출을 검증하지 못했다
// (anthropicClient.js와 동일한 제약) - 배포 후 실제로 잘 되는지 확인이 필요하다.
// 실패해도(레딧이 막거나 결과가 없거나) 영상 제작 전체를 막으면 안 되므로 항상 빈 배열을 반환한다.
// ============================================================

const USER_AGENT = 'web:anyone-dashboard-psychology-content:v1.0 (by /u/anyone_personal_tool)'

/**
 * 지정한 서브레딧들에서 query로 검색해서 실제 사연 게시물 후보를 가져온다.
 * @param {object} params
 * @param {string} params.query - 검색어 (영어 권장 - 레딧은 영어 커뮤니티가 압도적으로 큼)
 * @param {string[]} [params.subreddits] - 검색할 서브레딧 목록 (기본: 가족/관계 고민 커뮤니티)
 * @param {number} [params.limit] - 가져올 개수
 * @returns {Promise<Array<{title: string, body: string, score: number, url: string}>>}
 */
export async function searchRedditStories({
  query,
  subreddits = ['relationship_advice', 'relationships', 'family', 'AgingParents'],
  limit = 8,
}) {
  if (!query || !query.trim()) return []

  try {
    const subredditPath = subreddits.join('+')
    const params = new URLSearchParams({
      q: query,
      restrict_sr: '1',
      sort: 'relevance',
      t: 'year',
      limit: String(Math.min(limit, 25)),
    })
    const url = `https://www.reddit.com/r/${subredditPath}/search.json?${params.toString()}`

    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const data = await res.json()

    return (data.data?.children || [])
      .map((c) => c.data)
      .filter((p) => p && p.title && !p.over_18)
      .map((p) => ({
        title: p.title,
        body: (p.selftext || '').slice(0, 800), // 너무 길면 프롬프트만 낭비되니 앞부분만
        score: p.score || 0,
        url: `https://www.reddit.com${p.permalink}`,
      }))
      .sort((a, b) => b.score - a.score)
  } catch {
    return []
  }
}

/**
 * 검색 결과를 프롬프트에 바로 넣을 수 있는 텍스트 블록으로 정리.
 * 실제 글을 그대로 베끼면 안 되니(원작자 보호 + 저작권), 여기서는 "각색용 소재"라는 걸
 * 명확히 표시만 하고, 실제 각색 지시는 psychologyScript.js의 프롬프트에서 담당한다.
 */
export function formatRedditStoriesForPrompt(stories) {
  if (!stories || stories.length === 0) return ''
  return stories
    .slice(0, 5)
    .map((s, i) => `[사연 후보 ${i + 1}] ${s.title}\n${s.body || '(본문 없음, 제목만 참고)'}`)
    .join('\n\n')
}
