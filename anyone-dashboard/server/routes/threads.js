// ============================================================
// 스레드 자동 입력 - 2026-07-20에 인스타/틱톡과 같은 방식(Playwright로 로그인 세션에 들어가
// 글/이미지를 자동으로 채우고, 마지막 "게시" 버튼만 사람이 직접 누름)으로 추가했었음.
//
// 2026-07-26: 진희님 실제 틱톡 계정이 영구정지됨 - "마지막 게시는 사람이 누른다"는 안전장치가
// 있었는데도(인스타/틱톡/스레드 셋 다 동일 설계) 정지를 막지 못했음이 확인돼서, 이 패턴을 쓰는
// 인스타·틱톡 자동화를 먼저 끈 데 이어 진희님 확인 후 스레드도 동일하게 중단함. 다시 켤 땐
// 공식 Threads API(Meta 비즈니스 인증 필요)로 새로 만들 것, 이 브라우저 자동화 방식으로
// 되살리면 안 됨. 원래 구현은 git 이력에 남아있음.
// ============================================================

import { Router } from 'express'
import { getPage } from '../lib/localBrowser.js'

const router = Router()

router.post('/threads/open-login', async (req, res) => {
  try {
    const page = await getPage('threads')
    await page.goto('https://www.threads.net/login', { waitUntil: 'domcontentloaded' })
    res.json({ ok: true, message: '스레드 로그인 창을 열었어요. 처음 한 번만 직접 로그인해주세요.' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/threads/prepare', async (req, res) => {
  res.status(403).json({
    error: '계정 보호를 위해 스레드 자동 입력을 껐어요 (틱톡 계정 영구정지 후 안전 조치). 글/이미지는 위에서 복사해서 스레드 앱/웹에 직접 올려주세요.',
  })
})

export default router
