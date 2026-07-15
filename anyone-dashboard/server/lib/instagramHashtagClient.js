// ============================================================
// 인스타그램 해시태그 인기 게시물 수집 - apify/instagram-hashtag-scraper
// ============================================================

import { runApifyActor } from './apifyClient.js'

const ACTOR_IG_HASHTAG = 'apify~instagram-hashtag-scraper'

export async function searchInstagramHashtag({ hashtag, resultsLimit = 5 }) {
  if (!hashtag) {
    throw new Error('해시태그(hashtag)가 필요해요.')
  }

  const items = await runApifyActor(ACTOR_IG_HASHTAG, {
    hashtags: [hashtag],
    resultsType: 'posts',
    resultsLimit,
  })

  return (items || [])
    .filter((item) => item && !item.error)
    .map((item) => ({
      caption: item.caption || '',
      likesCount: item.likesCount || 0,
      commentsCount: item.commentsCount || 0,
      url: item.url,
      displayUrl: item.displayUrl,
      ownerUsername: item.ownerUsername,
      timestamp: item.timestamp,
    }))
}
