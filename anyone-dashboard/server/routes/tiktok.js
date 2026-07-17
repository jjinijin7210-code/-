// ============================================================
// 틱톡 자동 입력 - 인스타그램 자동 입력(server/routes/instagram.js)과 완전히 같은 원리.
// 같은 로컬 브라우저 창(server/lib/localBrowser.js)을 같이 쓰되, 도메인이 달라서
// 로그인 쿠키는 인스타그램과 별도로 저장된다 (틱톡은 처음 한 번만 따로 로그인하면 됨).
// 안전 모드: 사진과 캡션을 채운 뒤 마지막 "게시" 버튼은 사람이 직접 누른다.
// ============================================================

import { Router } from 'express'
import fs from 'node:fs'
import { getPage, clickFirstVisible, saveErrorScreenshot, dataUrlToFile } from '../lib/localBrowser.js'

const router = Router()
const UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload?from=webapp'

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
  const { caption, imageDataUrl } = req.body || {}
  if (!caption?.trim()) return res.status(400).json({ error: '본문/캡션이 비어 있어요.' })
  if (!imageDataUrl) return res.status(400).json({ error: '게시할 이미지가 없어요.' })

  let tempFile
  let page
  try {
    page = await getPage('tiktok')
    await page.goto(UPLOAD_URL, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)

    // 로그인 안 된 상태면 업로드 페이지가 로그인 선택 화면(/login)으로 리다이렉트된다.
    // (예전엔 "로그인"이라는 글자만 정확히 찾았는데, 실제 화면엔 "TikTok에 로그인"처럼
    // 다른 글자와 붙어있어서 못 찾는 경우가 있었음 - 주소(URL) 자체로 판단하는 게 더 확실함)
    const loginNeeded = page.url().includes('/login') || (await page.getByText(/QR 코드 사용|전화\/이메일\/아이디/i).first().isVisible().catch(() => false))
    if (loginNeeded) {
      return res.status(409).json({
        error: '틱톡 로그인이 필요해요. 열린 창에서 로그인한 뒤 다시 눌러주세요.',
        loginRequired: true,
      })
    }

    // 업로드 화면에 "사진"/"동영상" 모드를 고르는 탭이 있으면 사진 모드로 전환 (없으면 그냥 지나감)
    await clickFirstVisible(page, [
      page.getByRole('tab', { name: /^사진$|^photo$/i }),
      page.getByRole('button', { name: /^사진$|^photo$/i }),
      page.getByText(/^사진$|^photos$/i, { exact: true }),
    ])
    await page.waitForTimeout(300)

    tempFile = dataUrlToFile(imageDataUrl, 'tiktok')

    const fileInput = page.locator('input[type="file"]')
    await fileInput.waitFor({ state: 'attached', timeout: 20000 })
    await fileInput.setInputFiles(tempFile)

    // 업로드 후 편집 화면(캡션 입력창)이 뜰 때까지 대기 - 틱톡은 업로드 처리에 시간이 좀 더 걸림
    const captionBox = page
      .locator('[contenteditable="true"][data-e2e*="caption" i], [contenteditable="true"][aria-label*="설명" i], [contenteditable="true"]')
      .first()
    await captionBox.waitFor({ state: 'visible', timeout: 30000 })
    await page.waitForTimeout(500)
    await captionBox.fill(caption.trim())

    res.json({
      ok: true,
      readyToShare: true,
      message: '사진과 글을 채웠어요. 열린 틱톡 창에서 내용을 확인하고 마지막 게시 버튼만 눌러주세요.',
    })
  } catch (err) {
    const screenshotPath = await saveErrorScreenshot(page)
    res.status(500).json({
      error: screenshotPath
        ? `${err.message} (실패 순간 화면이 여기 저장됐어요: ${screenshotPath})`
        : err.message,
    })
  } finally {
    if (tempFile) fs.promises.unlink(tempFile).catch(() => {})
  }
})

export default router
