import { Router } from 'express'
import { downloadVideoFromUrl, deleteDownloadedVideo } from '../lib/videoDownloader.js'

const router = Router()

// 해외(중국 등) 링크 영상 다운로드 - 쇼핑쇼츠 벤치마킹용 참고 시청 목적.
router.post('/video-download', async (req, res) => {
  const { url } = req.body || {}
  if (!url || !url.trim()) {
    return res.status(400).json({ error: '링크(url)는 필수예요.' })
  }
  try {
    const result = await downloadVideoFromUrl(url.trim())
    res.json(result)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// 받아둔 영상 파일 삭제 (디스크 용량 정리용)
router.delete('/video-download/:fileName', (req, res) => {
  try {
    deleteDownloadedVideo(req.params.fileName)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

export default router
