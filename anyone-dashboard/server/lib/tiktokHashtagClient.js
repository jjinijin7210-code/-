// ============================================================
// 틱톡 해시태그 인기 게시물 수집 - clockworks/tiktok-hashtag-scraper
// ============================================================

import { runApifyActor } from './apifyClient.js'

const ACTOR_TIKTOK_HASHTAG = 'clockworks~tiktok-hashtag-scraper'

export async function searchTiktokHashtag({ hashtag, resultsPerPage = 5 }) {
  if (!hashtag) {
    throw new Error('해시태그(hashtag)가 필요해요.')
  }

  const items = await runApifyActor(ACTOR_TIKTOK_HASHTAG, {
    hashtags: [hashtag],
    resultsPerPage,
  })

  return (items || [])
    .filter((item) => item && !item.error)
    .map((item) => ({
      caption: item.text || '',
      likesCount: item.diggCount || 0,
      playCount: item.playCount || 0,
      commentCount: item.commentCount || 0,
      url: item.webVideoUrl,
      coverUrl: item.videoMeta?.coverUrl,
      authorName: item.authorMeta?.name,
      createTime: item.createTime,
    }))
}
