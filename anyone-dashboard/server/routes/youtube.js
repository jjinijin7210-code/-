import { Router } from 'express'
import { searchPopularVideosMultiRegion, getVideoById } from '../lib/youtubeClient.js'

const router = Router()

// 검색이 아니라 진희님이 직접 찾은 특정 영상을 URL로 바로 가져올 때 씀 (2026-07-19)
router.get('/youtube/lookup', async (req, res) => {
  const { url } = req.query
  if (!url || !String(url).trim()) {
    return res.status(400).json({ error: '유튜브 URL이 필요해요.' })
  }
  try {
    const video = await getVideoById(url)
    res.json({ video })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

router.get('/youtube/search', async (req, res) => {
  const { q, minLikes, regionCodes, videoDuration } = req.query

  if (!q || !String(q).trim()) {
    return res.status(400).json({ error: '검색어(q)는 필수예요.' })
  }

  try {
    // 지역을 하나로 고정하지 않고 여러 나라(쉼표로 구분)를 한 번에 같이 확인함
    const regions = regionCodes ? String(regionCodes).split(',').map((r) => r.trim()).filter(Boolean) : undefined
    const videos = await searchPopularVideosMultiRegion({
      query: q,
      minLikes: minLikes ? Number(minLikes) : 10000,
      regionCodes: regions,
      videoDuration: videoDuration || undefined,
    })
    res.json({ videos })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
