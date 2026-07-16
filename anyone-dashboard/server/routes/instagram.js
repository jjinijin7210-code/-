import { Router } from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const router = Router()
const PROFILE_DIR = path.join(os.homedir(), '.anyone-instagram-profile')
const TEMP_DIR = path.join(os.tmpdir(), 'anyone-instagram')

let browserContext = null
let activePage = null

function ensureLocalAutomationEnabled() {
  if (process.env.ENABLE_LOCAL_BROWSER_AUTOMATION !== 'true') {
    throw new Error('로컬 브라우저 자동화가 꺼져 있어요. .env에 ENABLE_LOCAL_BROWSER_AUTOMATION=true를 추가해주세요.')
  }
}

async function getPage() {
  ensureLocalAutomationEnabled()
  if (!browserContext) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true })
    browserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      viewport: null,
      args: ['--start-maximized'],
    })
    browserContext.on('close', () => {
      browserContext = null
      activePage = null
    })
  }

  if (!activePage || activePage.isClosed()) {
    activePage = browserContext.pages()[0] || await browserContext.newPage()
  }
  return activePage
}

function dataUrlToFile(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || '')
  if (!match) throw new Error('첨부 이미지가 올바른 data URL 형식이 아니에요.')

  const mime = match[1]
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
  fs.mkdirSync(TEMP_DIR, { recursive: true })
  const filePath = path.join(TEMP_DIR, `instagram-${Date.now()}.${ext}`)
  fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'))
  return filePath
}

async function clickFirstVisible(page, candidates) {
  for (const locator of candidates) {
    if (await locator.first().isVisible().catch(() => false)) {
      await locator.first().click()
      return true
    }
  }
  return false
}

router.post('/instagram/open-login', async (req, res) => {
  try {
    const page = await getPage()
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' })
    res.json({ ok: true, message: '인스타그램 창을 열었어요. 처음 한 번만 직접 로그인해주세요.' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 안전 모드: 사진과 캡션을 채운 뒤 마지막 "공유" 버튼은 사람이 직접 누릅니다.
router.post('/instagram/prepare', async (req, res) => {
  const { caption, imageDataUrl } = req.body || {}
  if (!caption?.trim()) return res.status(400).json({ error: '본문/캡션이 비어 있어요.' })
  if (!imageDataUrl) return res.status(400).json({ error: '게시할 이미지가 없어요.' })

  let tempFile
  try {
    const page = await getPage()
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' })

    const loginInput = page.locator('input[name="username"]')
    if (await loginInput.isVisible().catch(() => false)) {
      return res.status(409).json({
        error: '인스타그램 로그인이 필요해요. 열린 창에서 로그인한 뒤 다시 눌러주세요.',
        loginRequired: true,
      })
    }

    tempFile = dataUrlToFile(imageDataUrl)

    const createClicked = await clickFirstVisible(page, [
      page.getByRole('link', { name: /만들기|create/i }),
      page.getByRole('button', { name: /만들기|create/i }),
      page.locator('svg[aria-label="새 게시물"], svg[aria-label="New post"]').locator('..'),
    ])
    if (!createClicked) throw new Error('인스타그램의 만들기 버튼을 찾지 못했어요. 화면 구성이 바뀌었을 수 있어요.')

    const fileInput = page.locator('input[type="file"]')
    await fileInput.waitFor({ state: 'attached', timeout: 15000 })
    await fileInput.setInputFiles(tempFile)

    for (let i = 0; i < 2; i += 1) {
      const nextClicked = await clickFirstVisible(page, [
        page.getByRole('button', { name: /^다음$|^next$/i }),
        page.getByText(/^다음$|^next$/i, { exact: true }),
      ])
      if (!nextClicked) break
      await page.waitForTimeout(800)
    }

    const captionBox = page.locator('[contenteditable="true"][role="textbox"], textarea[aria-label*="문구"], textarea[aria-label*="caption" i]').last()
    await captionBox.waitFor({ state: 'visible', timeout: 15000 })
    await captionBox.fill(caption.trim())

    res.json({
      ok: true,
      readyToShare: true,
      message: '사진과 글을 채웠어요. 열린 인스타그램 창에서 내용을 확인하고 마지막 공유 버튼만 눌러주세요.',
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    if (tempFile) fs.promises.unlink(tempFile).catch(() => {})
  }
})

export default router
