// ============================================================
// 네이버 블로그 자동 입력 - 인스타/틱톡/스레드와 같은 방식(Playwright로 로그인 세션에 들어가
// 제목/본문/이미지를 자동으로 채우고, 마지막 "발행" 버튼만 사람이 직접 누름)으로 동작했음.
//
// 2026-07-26: 진희님 실제 틱톡 계정이 영구정지됨 - "마지막 발행은 사람이 누른다"는 안전장치가
// 있었는데도(인스타/틱톡/스레드 전부 동일 설계) 정지를 막지 못했음이 확인돼서, 같은 패턴을
// 쓰는 인스타·틱톡·스레드 자동화를 먼저 끄고 진희님 확인 후 네이버 블로그도 동일하게 중단함.
// 다시 켤 땐 공식 네이버 블로그 API로 새로 만들 것, 이 브라우저 자동화 방식으로 되살리면
// 안 됨. 원래 구현은 git 이력에 남아있음.
// ============================================================

import { Router } from 'express'
import { getPage } from '../lib/localBrowser.js'

const router = Router()

router.post('/naverblog/open-login', async (req, res) => {
  try {
    const page = await getPage('naverblog')
    await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' })
    res.json({ ok: true, message: '네이버 로그인 창을 열었어요. 처음 한 번만 직접 로그인해주세요.' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/naverblog/prepare', async (req, res) => {
  res.status(403).json({
    error: '계정 보호를 위해 네이버 블로그 자동 입력을 껐어요 (틱톡 계정 영구정지 후 안전 조치). 제목/본문/이미지는 위에서 복사해서 네이버 블로그에 직접 올려주세요.',
  })
})

export default router
