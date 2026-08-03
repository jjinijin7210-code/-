import { Router } from 'express'
import { generateShortsVideo, GENERATED_DIR } from '../lib/shortsGenerator.js'
import { sendTelegramNotification } from '../lib/telegramNotifier.js'
import { uploadVideoToYoutube } from '../lib/youtubeUploadClient.js'
import { tokenStore } from './auth.js'

export { GENERATED_DIR }

const router = Router()

router.post('/shorts/generate', async (req, res) => {
  const { title, imageUrls, note, narrationText } = req.body || {}

  if (!title || !title.trim()) {
    return res.status(400).json({ error: '제목(title)은 필수예요.' })
  }
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    return res.status(400).json({ error: '이미지(imageUrls)는 최소 1개 필요해요.' })
  }

  try {
    const { fileName, videoUrl, script } = await generateShortsVideo({ title, imageUrls, note, narrationText })
    const finalVideoUrl = videoUrl || `/generated/${fileName}`

    // 텔레그램 알림 발송
    sendTelegramNotification(
      `<b>🚀 [애니원] 새 숏폼 영상 완성!</b>\n\n` +
      `📌 <b>제목:</b> ${title}\n` +
      `🎬 <b>영상 URL:</b> ${finalVideoUrl}\n\n` +
      `👉 <a href="http://localhost:5173">애니원 대시보드 바로가기</a>`
    ).catch(() => {})

    res.json({ videoUrl: finalVideoUrl, script })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// 유튜브 쇼츠 자동 업로드 라우터.
// 2026-08-03 버그 수정: 원래 이름이 "3대 플랫폼 동시 업로드"였고 인스타그램/틱톡도
// results.instagram/tiktok = true로 하드코딩해서 텔레그램에 "성공"이라고 거짓 알림을
// 보내고 있었음 - 실제로는 그 두 플랫폼에 API 호출 자체가 없었음(CLAUDE.md 원칙상 인스타/
// 틱톡 공식 API 자동 발행은 Tech Provider 인증이 먼저 필요한 별개 작업이라 여기서 함부로
// 만들면 안 됨). 실제로 되는 유튜브만 정직하게 시도하고, 인스타/틱톡은 "수동 발행 필요"로
// 명확히 표시함.
router.post('/shorts/publish-multi', async (req, res) => {
  const { title, videoUrl, platforms = ['youtube'] } = req.body || {}
  const results = { youtube: false, instagram: 'manual', tiktok: 'manual' }
  let youtubeError = null

  if (platforms.includes('youtube')) {
    try {
      const tokens = await tokenStore.read()
      if (!tokens?.access_token) {
        youtubeError = '유튜브 계정이 연결되어 있지 않아요 (설정에서 로그인해주세요).'
      } else {
        const videoRes = await fetch(videoUrl.startsWith('http') ? videoUrl : `http://localhost:3001${videoUrl}`)
        if (!videoRes.ok) throw new Error(`영상 파일을 불러오지 못했어요 (${videoRes.status})`)
        const videoBuffer = Buffer.from(await videoRes.arrayBuffer())
        await uploadVideoToYoutube({
          accessToken: tokens.access_token,
          videoBuffer,
          title,
          description: `${title} #Shorts #트롯충전소 #바이럴`,
          tags: ['shorts', 'trot', 'viral'],
          privacyStatus: 'public'
        })
        results.youtube = true
      }
    } catch (e) {
      youtubeError = e.message
      console.warn('유튜브 쇼츠 자동 업로드 실패:', e.message)
    }
  }

  sendTelegramNotification(
    `<b>${results.youtube ? '✅' : '⚠️'} [애니원] 숏폼 업로드 결과</b>\n\n` +
    `📌 <b>제목:</b> ${title}\n` +
    `🔴 <b>유튜브 쇼츠:</b> ${results.youtube ? '성공 ✅' : `실패 ❌ (${youtubeError || '알 수 없는 오류'})`}\n` +
    `📸 <b>인스타그램 릴스:</b> 자동 업로드 미지원 - 직접 올려주세요\n` +
    `🎵 <b>틱톡:</b> 자동 업로드 미지원 - 직접 올려주세요\n`
  ).catch(() => {})

  res.json({ ok: results.youtube, results, youtubeError })
})

export default router
