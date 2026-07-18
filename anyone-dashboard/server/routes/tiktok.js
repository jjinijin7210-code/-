// ============================================================
// 틱톡 자동 입력 - 인스타그램 자동 입력(server/routes/instagram.js)과 완전히 같은 원리.
// 같은 로컬 브라우저 창(server/lib/localBrowser.js)을 같이 쓰되, 도메인이 달라서
// 로그인 쿠키는 인스타그램과 별도로 저장된다 (틱톡은 처음 한 번만 따로 로그인하면 됨).
// 안전 모드: 사진과 캡션을 채운 뒤 마지막 "게시" 버튼은 사람이 직접 누른다.
//
// 2026-07-18: 틱톡 스튜디오 업로드 화면에서 "사진" 모드 자체가 사라지고 동영상만
// 받게 됨(실측 확인함) - 그래서 사진을 그대로 올리는 대신, 사진 1~3장을 짧은
// 슬라이드쇼 영상(videoRenderer.js)으로 먼저 만든 다음 그 영상 파일을 올림.
// ============================================================

import { Router } from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { getPage, saveErrorScreenshot, dataUrlToFile } from '../lib/localBrowser.js'
import { composeSimpleSlideshow } from '../lib/videoRenderer.js'

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
  // 하위 호환: 예전 방식(imageDataUrl 하나)으로 호출해도 배열로 취급해서 그대로 동작함
  const { caption, imageDataUrl, imageDataUrls } = req.body || {}
  const images = imageDataUrls?.length ? imageDataUrls : imageDataUrl ? [imageDataUrl] : []
  if (!caption?.trim()) return res.status(400).json({ error: '본문/캡션이 비어 있어요.' })
  if (images.length === 0) return res.status(400).json({ error: '게시할 이미지가 없어요.' })
  if (images.length > 3) return res.status(400).json({ error: '이미지는 최대 3장까지만 붙일 수 있어요.' })

  const tempFiles = []
  let videoFile
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

    // 사진들을 짧은 슬라이드쇼 영상으로 합성 (사진 1장이어도 3초짜리 영상 하나로 만듦)
    images.forEach((dataUrl, i) => tempFiles.push(dataUrlToFile(dataUrl, `tiktok-src-${i}`)))
    const videoOutDir = path.join(os.tmpdir(), 'anyone-tiktok-video')
    fs.mkdirSync(videoOutDir, { recursive: true })
    videoFile = path.join(videoOutDir, `${crypto.randomUUID()}.mp4`)
    composeSimpleSlideshow(tempFiles, videoFile)

    const fileInput = page.locator('input[type="file"]')
    await fileInput.waitFor({ state: 'attached', timeout: 20000 })
    await fileInput.setInputFiles(videoFile)

    // 업로드 후 편집 화면(캡션 입력창)이 뜰 때까지 대기 - 틱톡은 업로드 처리에 시간이 좀 더 걸림
    const captionBox = page
      .locator('[contenteditable="true"][data-e2e*="caption" i], [contenteditable="true"][aria-label*="설명" i], [contenteditable="true"]')
      .first()
    await captionBox.waitFor({ state: 'visible', timeout: 45000 })
    await page.waitForTimeout(500)
    await captionBox.fill(caption.trim())

    res.json({
      ok: true,
      readyToShare: true,
      message: `사진 ${images.length}장을 영상으로 만들어서 글까지 채웠어요. 열린 틱톡 창에서 내용을 확인하고 마지막 게시 버튼만 눌러주세요.`,
    })
  } catch (err) {
    const screenshotPath = await saveErrorScreenshot(page)
    res.status(500).json({
      error: screenshotPath
        ? `${err.message} (실패 순간 화면이 여기 저장됐어요: ${screenshotPath})`
        : err.message,
    })
  } finally {
    for (const f of tempFiles) fs.promises.unlink(f).catch(() => {})
    if (videoFile) fs.promises.unlink(videoFile).catch(() => {})
  }
})

export default router
