// ============================================================
// 유튜브 트렌드 분석 직원 - 한국 개인 채널(트로트/감동사연/AI영상/쇼핑쇼츠 등) 기획용.
// 장르별 키워드로 최근 영상을 모아서 "상승 속도" 중심 점수를 매기고, AI가 제목의 감정/후킹
// 요소를 분석해서 성공 패턴+신규 아이디어 리포트를 만든다.
// DB 저장은 프론트엔드가 로그인 세션으로 직접 함(다른 수동 검색 기능들과 같은 방식) -
// 이 라우트는 순수 조회/분석 결과만 돌려준다.
// ============================================================

import { Router } from 'express'
import { searchVideosForTrendScan } from '../lib/youtubeClient.js'
import { scoreAndRankVideos } from '../lib/youtubeTrendScore.js'
import { analyzeAndReport } from '../lib/youtubeTrendAnalysis.js'

const router = Router()

// 장르별 기본 검색 키워드 (진희님이 원하면 요청 시 keywords로 직접 덮어쓸 수 있음)
const GENRE_KEYWORDS = {
  트로트: ['트로트 신곡', '트로트 커버', '미스터트롯'],
  감성음악: ['감성 플레이리스트', '새벽 감성 노래', '가사 좋은 노래 모음'],
  감동사연: ['감동 실화', '감동 사연', '눈물나는 이야기'],
  AI영상: ['AI 영상 제작', 'AI 도구 추천', 'ChatGPT 활용법'],
  쇼핑쇼츠: ['가성비템 추천', '신박한 아이템', '요즘 핫한 상품'],
}

router.post('/youtube-trend/scan', async (req, res) => {
  const { genre, keywords: customKeywords, days } = req.body || {}
  if (!genre) {
    return res.status(400).json({ error: '장르(genre)가 필요해요.' })
  }
  const keywords = customKeywords && customKeywords.length > 0 ? customKeywords : GENRE_KEYWORDS[genre]
  if (!keywords || keywords.length === 0) {
    return res.status(400).json({
      error: `"${genre}" 장르는 등록된 검색 키워드가 없어요. GENRE_KEYWORDS에 추가하거나 keywords를 직접 보내주세요.`,
    })
  }

  const publishedAfter = new Date(Date.now() - (Number(days) || 7) * 24 * 60 * 60 * 1000).toISOString()

  try {
    const resultsByKeyword = await Promise.all(
      keywords.map((q) =>
        searchVideosForTrendScan({ query: q, regionCode: 'KR', publishedAfter, maxResults: 15 }).catch((err) => {
          console.error(`[youtube-trend/scan] "${q}" 검색 실패:`, err.message)
          return []
        })
      )
    )
    const seen = new Map()
    for (const list of resultsByKeyword) {
      for (const v of list) {
        if (!seen.has(v.videoId)) seen.set(v.videoId, v)
      }
    }
    const videos = [...seen.values()]

    if (videos.length === 0) {
      return res.json({
        ok: true,
        genre,
        scoredVideos: [],
        report: null,
        warning: '조건에 맞는 영상을 찾지 못했어요 (데이터 없음). 키워드나 기간을 바꿔서 다시 시도해보세요.',
      })
    }

    const scoredVideos = scoreAndRankVideos(videos)

    let topVideos = scoredVideos.slice(0, 10)
    let report = null
    try {
      const analyzed = await analyzeAndReport({ genre, scoredVideos })
      topVideos = analyzed.topVideos.map((v, i) => ({ ...v, ...analyzed.analyses[i] }))
      report = analyzed.report
    } catch (aiErr) {
      console.error('[youtube-trend/scan] AI 분석 실패, 점수 결과만 반환:', aiErr.message)
      report = null
    }

    res.json({ ok: true, genre, scoredVideos: topVideos, allVideos: scoredVideos, report })
  } catch (err) {
    const isQuota = /quota|403/i.test(err.message)
    res.status(502).json({
      error: isQuota ? `유튜브 API 할당량을 초과했을 수 있어요: ${err.message}` : err.message,
    })
  }
})

export default router
