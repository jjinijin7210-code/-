import { Router } from 'express'
import { getPage, clickFirstVisible, saveErrorScreenshot } from '../lib/localBrowser.js'

const router = Router()

// 인스타/틱톡과 같은 안전 모드: 제목/본문만 채우고, 마지막 "발행" 버튼은 사람이 직접 누른다.
// 네이버 블로그 에디터(스마트에디터 ONE)는 iframe(#mainFrame) 안에 있고 버전이 자주 바뀌어서,
// 인스타/틱톡보다 선택자가 깨질 가능성이 높음 - 실패하면 saveErrorScreenshot으로 화면을 남긴다.

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
  const { title, body } = req.body || {}
  if (!title?.trim()) return res.status(400).json({ error: '제목이 비어 있어요.' })
  if (!body?.trim()) return res.status(400).json({ error: '본문이 비어 있어요.' })

  let page
  try {
    page = await getPage('naverblog')
    // 로그인된 계정의 블로그 글쓰기 화면으로 바로 이동시켜주는 네이버 자체 리다이렉트 주소
    // (블로그 아이디를 몰라도 됨 - 이미 로그인돼 있어야 정상 작동함)
    await page.goto('https://blog.naver.com/GoBlogWrite.naver', { waitUntil: 'domcontentloaded' })

    const loginInput = page.locator('#id')
    if (await loginInput.isVisible().catch(() => false)) {
      return res.status(409).json({
        error: '네이버 로그인이 필요해요. 열린 창에서 로그인한 뒤 다시 눌러주세요.',
        loginRequired: true,
      })
    }

    // 작성 중이던 글이 있으면 "이어쓰기/취소(새로 작성)" 팝업이 뜸 - 새로 작성으로 진행
    await page.waitForTimeout(1000)
    await clickFirstVisible(page, [
      page.getByRole('button', { name: /취소/ }),
      page.getByText(/취소/),
    ])

    const frame = page.frameLocator('#mainFrame')
    const titleBox = frame.locator('.se-title-text, [class*="title"][contenteditable="true"]').first()
    await titleBox.waitFor({ state: 'visible', timeout: 15000 })
    await titleBox.click()
    await page.keyboard.type(title.trim())

    await page.keyboard.press('Enter') // 제목 다음 줄로 이동하면 보통 본문 영역으로 넘어감
    const bodyBox = frame.locator('.se-text-paragraph, .se-component-content [contenteditable="true"]').first()
    await bodyBox.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
    await page.keyboard.type(body.trim())

    res.json({
      ok: true,
      readyToPublish: true,
      message: '제목과 본문을 채웠어요. 이미지는 직접 첨부해주시고, 내용 확인 후 열린 창에서 발행 버튼만 눌러주세요.',
    })
  } catch (err) {
    const screenshotPath = await saveErrorScreenshot(page)
    res.status(500).json({
      error: screenshotPath
        ? `${err.message} (실패 순간 화면이 여기 저장됐어요: ${screenshotPath})`
        : err.message,
    })
  }
})

export default router
