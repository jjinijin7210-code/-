import { Router } from 'express'
import { searchPopularVideosMultiRegion } from '../lib/youtubeClient.js'

const router = Router()

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
