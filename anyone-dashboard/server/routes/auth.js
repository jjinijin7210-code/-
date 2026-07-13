import { Router } from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGoogleAuthUrl } from '../lib/googleOAuth.js'
import { exchangeCodeForTokens } from '../lib/googleTokenClient.js'
import { createTokenStore } from '../lib/tokenStore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const tokenStore = createTokenStore(path.join(__dirname, '..', '.data', 'google-tokens.json'))

const router = Router()

// 이 주소를 브라우저로 열면 구글 로그인/동의 화면으로 이동함
router.get('/google', (req, res) => {
  try {
    const url = buildGoogleAuthUrl({
      clientId: process.env.GOOGLE_CLIENT_ID,
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
    })
    res.redirect(url)
  } catch (err) {
    res.status(500).send(`구글 연동 설정 오류: ${err.message}`)
  }
})

// 구글이 인증 후 이 주소로 돌려보냄 (redirect_uri와 반드시 일치해야 함)
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query
  if (error) return res.status(400).send(`구글 인증이 취소되었어요: ${error}`)
  if (!code) return res.status(400).send('인증 코드가 없어요.')

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
    })
    tokenStore.save(tokens)
    res.send('구글 계정 연결이 완료됐어요! 이 창을 닫고 대시보드로 돌아가주세요.')
  } catch (err) {
    res.status(500).send(`토큰 교환 실패: ${err.message}`)
  }
})

export { tokenStore }
export default router
