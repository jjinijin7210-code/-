import { Router } from 'express'
import fs from 'node:fs'
import { getPage, clickFirstVisible, saveErrorScreenshot, dataUrlToFile } from '../lib/localBrowser.js'

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

// 안전 모드: 사진과 캡션을 채운 뒤 마지막 "공유" 버튼은 사람이 직접 누릅니다.
router.post('/instagram/prepare', async (req, res) => {
  const { caption, imageDataUrl } = req.body || {}
  if (!caption?.trim()) return res.status(400).json({ error: '본문/캡션이 비어 있어요.' })
  if (!imageDataUrl) return res.status(400).json({ error: '게시할 이미지가 없어요.' })

  let tempFile
  let page
  try {
    page = await getPage('instagram')
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' })

    const loginInput = page.locator('input[name="username"]')
    if (await loginInput.isVisible().catch(() => false)) {
      return res.status(409).json({
        error: '인스타그램 로그인이 필요해요. 열린 창에서 로그인한 뒤 다시 눌러주세요.',
        loginRequired: true,
      })
    }

    tempFile = dataUrlToFile(imageDataUrl, 'instagram')

    const createClicked = await clickFirstVisible(page, [
      page.getByRole('link', { name: /만들기|create|new post/i }),
      page.getByRole('button', { name: /만들기|create|new post/i }),
      page
        .locator('svg[aria-label*="만들기"], svg[aria-label*="게시물"], svg[aria-label*="New post"], svg[aria-label*="Create"]')
        .locator('xpath=ancestor::a[1] | ancestor::div[@role="button"][1]')
        .first(),
    ])
    if (!createClicked) throw new Error('인스타그램의 만들기 버튼을 찾지 못했어요. 화면 구성이 바뀌었을 수 있어요.')

    // "만들기"를 누르면 게시물/스토리/릴스 중에 고르는 작은 메뉴가 한 번 더 뜨는 경우가 있음 - 뜨면 "게시물" 선택
    await page.waitForTimeout(500)
    await clickFirstVisible(page, [
      page.getByRole('link', { name: /^게시물$|^post$/i }),
      page.getByRole('button', { name: /^게시물$|^post$/i }),
      page.getByText(/^게시물$|^post$/i, { exact: true }),
    ])

    const fileInput = page.locator('input[type="file"]')
    await fileInput.waitFor({ state: 'attached', timeout: 15000 })
    await fileInput.setInputFiles(tempFile)

    // "다음" 버튼을 눌러서 자르기 -> 편집 -> 문구 작성, 총 2단계를 넘어가야 함.
    // 화면에 안 보이는 동일 텍스트 요소가 섞여있거나(zero-width 문자 등) 클릭이 씹히는 경우가 있어서,
    // 매 클릭마다 실제로 화면(제목)이 바뀌었는지 확인하고 안 바뀌었으면 같은 단계에서 최대 3번까지 재시도한다.
    for (let step = 0; step < 2; step += 1) {
      const titleBefore = await page
        .locator('div[role="dialog"] h1, div[role="dialog"] h2')
        .first()
        .textContent()
        .catch(() => null)

      let advanced = false
      for (let attempt = 0; attempt < 3 && !advanced; attempt += 1) {
        const nextButton = page
          .locator('div[role="dialog"] div[role="button"], div[role="dialog"] button')
          .filter({ hasText: /다음|next/i })
          .first()

        if (await nextButton.isVisible().catch(() => false)) {
          await nextButton.click({ force: true }).catch(() => {})
        } else {
          await clickFirstVisible(page, [
            page.getByRole('button', { name: /다음|next/i }),
            page.getByText(/다음|next/i),
          ])
        }

        await page.waitForTimeout(700)
        const titleAfter = await page
          .locator('div[role="dialog"] h1, div[role="dialog"] h2')
          .first()
          .textContent()
          .catch(() => null)
        advanced = titleAfter !== titleBefore
      }
      if (!advanced) break
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
