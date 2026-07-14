import { Router } from 'express'
import { generateShortsVideo, GENERATED_DIR } from '../lib/shortsGenerator.js'

export { GENERATED_DIR }

const router = Router()

router.post('/shorts/generate', async (req, res) => {
  const { title, imageUrls, note } = req.body || {}

  if (!title || !title.trim()) {
    return res.status(400).json({ error: '제목(title)은 필수예요.' })
  }
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    return res.status(400).json({ error: '이미지(imageUrls)는 최소 1개 필요해요.' })
  }

  try {
    const { fileName, script } = await generateShortsVideo({ title, imageUrls, note })
    res.json({ videoUrl: `/generated/${fileName}`, script })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
