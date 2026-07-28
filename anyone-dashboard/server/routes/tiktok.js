// ============================================================
// 틱톡 자동 입력 - 2026-07-26 이전엔 인스타그램 자동 입력(server/routes/instagram.js)과 완전히
// 같은 원리(Playwright로 로그인된 세션에 들어가서 화면을 자동 조작)로 동작했음.
//
// 2026-07-26: 진희님 실제 틱톡 계정이 영구정지됨 - 원인이 100% 확정되진 않았지만, 바로 이
// 방식(공식 API가 아니라 로그인 세션을 스크립트가 자동 조작)이 플랫폼이 봇으로 의심할 만한
// 패턴이라 유력한 원인으로 보임. 같은 위험이 인스타그램에도 그대로 있어 진희님 확인 및
// 지시로 두 자동화(인스타/틱톡)를 동시에 즉시 중단함. 원래 구현(사진→슬라이드쇼 영상 합성→
// 업로드→캡션 자동 채움)은 git 이력에 남아있음 - 다시 켤 땐 틱톡 공식 Content Posting API
// 경로로 새로 만들 것, 이 브라우저 자동화 방식으로 되살리면 안 됨.
// ============================================================

import { Router } from 'express'
import { getPage } from '../lib/localBrowser.js'

const router = Router()

router.post('/tiktok/open-login', async (req, res) => {
  try {
    const page = await getPage('tiktok')
    await page.goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded' })
    res.json({ ok: true, message: '틱톡 창을 열었어요. 처음 한 번만 직접 로그인해주세요.' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/tiktok/prepare', async (req, res) => {
  res.status(403).json({
    error: '계정 보호를 위해 틱톡 자동 입력을 껐어요 (계정 영구정지 후 안전 조치). 캡션/이미지는 위에서 복사해서 틱톡 앱/웹에 직접 올려주세요.',
  })
})

export default router
