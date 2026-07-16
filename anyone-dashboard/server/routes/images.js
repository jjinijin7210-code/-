import { Router } from 'express'
import { generateImage, editImage } from '../lib/imageClient.js'

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

// 참고 사진을 올리면 그 느낌으로 비슷한 새 이미지를 AI가 다시 그려서 생성
router.post('/images/edit', async (req, res) => {
  const { imageDataUrl, prompt, size } = req.body || {}

  if (!imageDataUrl) {
    return res.status(400).json({ error: '참고 이미지가 필요해요.' })
  }
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: '이미지 설명(prompt)은 필수예요.' })
  }

  try {
    const dataUrl = await editImage({ imageDataUrl, prompt, size })
    res.json({ dataUrl })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
