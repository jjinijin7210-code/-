import { Router } from 'express'
import { getPage } from '../lib/localBrowser.js'

const router = Router()

router.post('/instagram/open-login', async (req, res) => {
  try {
    const page = await getPage('instagram')
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' })
    res.json({ ok: true, message: '인스타그램 창을 열었어요. 처음 한 번만 직접 로그인해주세요.' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 2026-07-26: 진희님 실제 틱톡 계정이 영구정지됨 - 원인이 100% 확정되진 않았지만, 틱톡 자동
// 업로드(routes/tiktok.js, 같은 날 동일하게 비활성화함)가 이것과 완전히 같은 방식(로그인된
// 세션에 Playwright로 들어가서 화면을 자동으로 조작)이었고, 인스타그램도 똑같은 패턴이라
// 같은 위험이 있어 즉시 중단함(진희님 확인 및 지시). 공식 API가 아니라 실제 로그인 세션을
// 스크립트가 조작하는 방식 자체가 플랫폼이 봇으로 의심할 만한 패턴이라, 계정을 지키기 위해
// 자동 입력은 끄고 캡션/이미지 생성까지만 계속 지원함 - 게시는 진희님이 직접 앱/웹에서
// 수동으로 해야 함. 원래 구현(Playwright로 만들기→업로드→캡션 자동 채움)은 git 이력에
// 남아있음 - 다시 켤 땐 공식 Graph API 경로로 새로 만들 것, 이 방식으로 되살리면 안 됨.
router.post('/instagram/prepare', async (req, res) => {
  res.status(403).json({
    error: '계정 보호를 위해 인스타그램 자동 입력을 껐어요 (틱톡 계정 영구정지 후 안전 조치). 캡션/이미지는 위에서 복사해서 인스타그램 앱/웹에 직접 올려주세요.',
  })
})

export default router
