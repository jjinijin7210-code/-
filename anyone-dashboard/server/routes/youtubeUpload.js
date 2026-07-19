// ============================================================
// 유튜브 영상 업로드 - blogger.js와 같은 패턴(사람이 버튼을 눌러야 실제로 올라감,
// AI 파이프라인이 검수 통과만으로 자동 업로드하지 않음).
// ============================================================

import { Router } from 'express'
import { uploadVideoToYoutube } from '../lib/youtubeUploadClient.js'
import { refreshAccessToken } from '../lib/googleTokenClient.js'
import { tokenStore } from './auth.js'

const router = Router()

// 프론트엔드가 "구글 계정이 연결되어 있는지" 확인할 때 사용 (블로거와 같은 연결을 공유함)
router.get('/youtube/upload-status', async (req, res) => {
  res.json({ connected: await tokenStore.isConnected() })
})

router.post('/youtube/upload', async (req, res) => {
  const { title, description, videoUrl, tags, privacyStatus } = req.body || {}
  if (!title || !videoUrl) {
    return res.status(400).json({ error: '제목(title)과 영상 주소(videoUrl)가 필요해요.' })
  }

  const tokens = await tokenStore.read()
  if (!tokens || !tokens.access_token) {
    return res.status(401).json({ error: '구글 계정이 연결되어 있지 않아요. 먼저 설정에서 연결해주세요.' })
  }

  try {
    const videoRes = await fetch(videoUrl)
    if (!videoRes.ok) throw new Error(`영상 파일을 가져오지 못했어요 (${videoRes.status})`)
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer())

    let accessToken = tokens.access_token
    let result
    try {
      result = await uploadVideoToYoutube({ accessToken, videoBuffer, title, description, tags, privacyStatus })
    } catch (err) {
      // access_token이 만료됐을 가능성이 있으니 refresh_token으로 한 번 갱신 후 재시도
      if (!tokens.refresh_token) throw err
      const refreshed = await refreshAccessToken({
        refreshToken: tokens.refresh_token,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      })
      await tokenStore.save(refreshed)
      accessToken = refreshed.access_token
      result = await uploadVideoToYoutube({ accessToken, videoBuffer, title, description, tags, privacyStatus })
    }
    res.json(result)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
