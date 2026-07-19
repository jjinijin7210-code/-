import { Router } from 'express'
import { publishToBloggerApi } from '../lib/bloggerClient.js'
import { refreshAccessToken } from '../lib/googleTokenClient.js'
import { tokenStore } from './auth.js'

const router = Router()

// 프론트엔드가 "구글 계정이 연결되어 있는지" 확인할 때 사용
router.get('/blogger/status', async (req, res) => {
  res.json({ connected: await tokenStore.isConnected() })
})

router.post('/blogger/publish', async (req, res) => {
  const { title, content, isDraft } = req.body || {}
  if (!title || !content) {
    return res.status(400).json({ error: '제목(title)과 본문(content)이 필요해요.' })
  }

  const tokens = await tokenStore.read()
  if (!tokens || !tokens.access_token) {
    return res.status(401).json({ error: '구글 계정이 연결되어 있지 않아요. 먼저 설정에서 연결해주세요.' })
  }

  try {
    let accessToken = tokens.access_token
    let result
    try {
      result = await publishToBloggerApi({ accessToken, blogId: process.env.BLOGGER_BLOG_ID, title, content, isDraft })
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
      result = await publishToBloggerApi({ accessToken, blogId: process.env.BLOGGER_BLOG_ID, title, content, isDraft })
    }
    res.json(result)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
