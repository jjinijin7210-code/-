import { Router } from 'express'
import { searchPhotos, fetchPhotoAsDataUrl } from '../lib/pexelsClient.js'

const router = Router()

router.get('/pexels/search', async (req, res) => {
  const { q, page } = req.query
  if (!q || !String(q).trim()) {
    return res.status(400).json({ error: '검색어(q)는 필수예요.' })
  }
  try {
    const photos = await searchPhotos({ query: q, page: page ? Number(page) : undefined })
    res.json({ photos })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

router.get('/pexels/fetch', async (req, res) => {
  const { url } = req.query
  if (!url) {
    return res.status(400).json({ error: '이미지 주소(url)는 필수예요.' })
  }
  try {
    const dataUrl = await fetchPhotoAsDataUrl(String(url))
    res.json({ dataUrl })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
