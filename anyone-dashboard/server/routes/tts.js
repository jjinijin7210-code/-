import { Router } from 'express'

const router = Router()

// 100% 무료 고품질 사람 목소리 Google TTS 프록시 API
router.get(['/tts/speak', '/tts'], async (req, res) => {
  const { text, lang = 'ko' } = req.query
  if (!text) return res.status(400).send('Text required')

  const cleanText = encodeURIComponent(text.slice(0, 200))
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${cleanText}`

  try {
    const audioRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })
    if (!audioRes.ok) throw new Error('TTS fetch failed')

    const arrayBuffer = await audioRes.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length
    })
    res.send(buffer)
  } catch (err) {
    res.status(500).send(err.message)
  }
})

export default router
