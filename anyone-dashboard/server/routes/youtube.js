import { Router } from 'express'
import { searchPopularVideos } from '../lib/youtubeClient.js'

const router = Router()

router.get('/youtube/search', async (req, res) => {
  const { q, minLikes, regionCode, videoDuration } = req.query

  if (!q || !String(q).trim()) {
    return res.status(400).json({ error: '검색어(q)는 필수예요.' })
  }

  try {
    const videos = await searchPopularVideos({
      query: q,
      minLikes: minLikes ? Number(minLikes) : 10000,
      regionCode: regionCode || undefined,
      videoDuration: videoDuration || undefined,
    })
    res.json({ videos })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
