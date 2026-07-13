import { Router } from 'express'
import { generateImage } from '../lib/imageClient.js'

const router = Router()

router.post('/images/generate', async (req, res) => {
  const { prompt, size } = req.body || {}

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: '이미지 설명(prompt)은 필수예요.' })
  }

  try {
    const dataUrl = await generateImage({ prompt, size })
    res.json({ dataUrl })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
