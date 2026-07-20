import { Router } from 'express'
import fs from 'node:fs'
import { getPage, clickFirstVisible, saveErrorScreenshot, dataUrlToFile } from '../lib/localBrowser.js'

const router = Router()

// 인스타그램/틱톡과 같은 안전 모드: 글(+이미지)만 채우고, 마지막 "게시" 버튼은 사람이 직접 누른다.
// CLAUDE.md의 "공식 API만 사용" 원칙과는 맞지 않지만(브라우저 자동화), 인스타/틱톡에서
// 이미 같은 방식·같은 위험도로 실사용 중이라는 걸 확인하고 사용자가 직접 결정해서 추가함
// (2026-07-20) - 화면이 보이는 채로 마지막 클릭만 사람이 하는 안전장치는 동일하게 유지.

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
  const { body, imageDataUrl } = req.body || {}
  if (!body?.trim()) return res.status(400).json({ error: '본문이 비어 있어요.' })

  let tempFile
  let page
  try {
    page = await getPage('threads')
    await page.goto('https://www.threads.net/', { waitUntil: 'domcontentloaded' })

    const loginInput = page.locator('input[name="username"]')
    if (await loginInput.isVisible().catch(() => false)) {
      return res.status(409).json({
        error: '스레드 로그인이 필요해요. 열린 창에서 로그인한 뒤 다시 눌러주세요.',
        loginRequired: true,
      })
    }

    // 새 스레드 작성 진입점 - 상단/사이드바의 "만들기"류 버튼, 없으면 피드에 바로 있는
    // "지금 무슨 생각을 하고 계신가요?" 입력칸을 클릭해서 작성 모달을 연다.
    const createClicked = await clickFirstVisible(page, [
      page.getByRole('link', { name: /만들기|create|new thread/i }),
      page.getByRole('button', { name: /만들기|create|new thread/i }),
      page.getByText(/무슨 생각을 하고 계신가요|what.?s new/i),
    ])
    if (!createClicked) throw new Error('스레드의 작성 버튼을 찾지 못했어요. 화면 구성이 바뀌었을 수 있어요.')

    await page.waitForTimeout(500)
    const bodyBox = page.locator('div[role="dialog"] [contenteditable="true"][role="textbox"]').first()
    await bodyBox.waitFor({ state: 'visible', timeout: 15000 })
    await bodyBox.fill(body.trim())

    if (imageDataUrl) {
      tempFile = dataUrlToFile(imageDataUrl, 'threads')
      const fileInput = page.locator('div[role="dialog"] input[type="file"]')
      if (await fileInput.count().catch(() => 0)) {
        await fileInput.first().setInputFiles(tempFile)
      }
    }

    res.json({
      ok: true,
      readyToShare: true,
      message: '글을 채웠어요. 열린 스레드 창에서 내용을 확인하고 마지막 게시 버튼만 눌러주세요.',
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
