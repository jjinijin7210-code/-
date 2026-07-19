// ============================================================
// 단순 누적 조회수가 아니라 "상승 속도" 중심으로 영상을 채점 - 유튜브 트렌드 분석 직원용.
// 게시 후 경과 시간 대비 조회수/좋아요/댓글 속도를 계산해서 트렌드 스코어를 매기고,
// 급상승/신규 급성장 영상에 라벨을 붙인다.
// ============================================================

const HOUR_MS = 60 * 60 * 1000
const LOW_VIEW_THRESHOLD = 50000 // 이 미만이면 "아직 조회수는 적은" 영상으로 간주

export function scoreVideo(video, now = new Date()) {
  const publishedAt = new Date(video.publishedAt)
  const hoursSincePublished = Math.max((now - publishedAt) / HOUR_MS, 0.5) // 0으로 나누기 방지
  const viewsPerHour = video.viewCount / hoursSincePublished
  const likeRate = video.viewCount > 0 ? video.likeCount / video.viewCount : 0
  const commentRate = video.viewCount > 0 ? video.commentCount / video.viewCount : 0

  // 조회수 속도가 기본, 좋아요율/댓글률이 높으면 가산 - 그냥 많이 본 것보다 "반응이 뜨거운" 걸 우대
  const trendScore = viewsPerHour * (1 + likeRate * 10 + commentRate * 20)

  return {
    ...video,
    hoursSincePublished: Math.round(hoursSincePublished * 10) / 10,
    viewsPerHour: Math.round(viewsPerHour),
    likeRate: Math.round(likeRate * 10000) / 10000,
    commentRate: Math.round(commentRate * 10000) / 10000,
    trendScore: Math.round(trendScore),
    isRising24h: hoursSincePublished <= 24,
    isRising7d: hoursSincePublished <= 24 * 7,
    isLowViewFastGrowth: video.viewCount < LOW_VIEW_THRESHOLD,
  }
}

// 여러 영상을 한 번에 채점 + trendScore 기준 내림차순 정렬
export function scoreAndRankVideos(videos, now = new Date()) {
  return videos.map((v) => scoreVideo(v, now)).sort((a, b) => b.trendScore - a.trendScore)
}
