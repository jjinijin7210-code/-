// ============================================================
// 로컬 전용 브라우저 자동화 - 사람 눈에 보이는 실제 크롬 창을 하나 띄워두고
// (server/routes/instagram.js, tiktok.js, instagramComments.js) 모두 이 창의
// 로그인 세션(쿠키)을 같이 쓴다. 다만 인스타그램/틱톡은 각자 자기 전용 탭을 따로
// 갖고 있어서 - getPage('instagram')과 getPage('tiktok')은 서로 다른 탭 - 한쪽이
// 화면을 옮기는 동안 다른 쪽 진행 중인 작업을 덮어써버리는 일이 없다.
// Render 배포 서버에서는 화면(display)이 없어서 동작하지 않음 - 진희님 컴퓨터에서만 씀.
// ============================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

export const PROFILE_DIR = path.join(os.homedir(), '.anyone-instagram-profile')
export const TEMP_DIR = path.join(os.tmpdir(), 'anyone-instagram')

let browserContext = null
const pagesByKey = new Map()

export function ensureLocalAutomationEnabled() {
  if (process.env.ENABLE_LOCAL_BROWSER_AUTOMATION !== 'true') {
    throw new Error('로컬 브라우저 자동화가 꺼져 있어요. .env에 ENABLE_LOCAL_BROWSER_AUTOMATION=true를 추가해주세요.')
  }
}

// key별로 전용 탭을 하나씩 유지한다 (예: 'instagram', 'tiktok') - 같은 창(윈도우) 안의
// 서로 다른 탭이라서 동시에 각자 다른 화면을 띄워놔도 서로 방해하지 않는다.
export async function getPage(key = 'default') {
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
      pagesByKey.clear()
    })
  }

  let page = pagesByKey.get(key)
  if (!page || page.isClosed()) {
    // 아직 탭이 하나도 없으면(창을 막 띄운 직후) 기본으로 열려있는 빈 탭을 재사용하고,
    // 이미 다른 key가 그 탭을 쓰고 있으면 새 탭을 연다.
    const reusable = pagesByKey.size === 0 ? browserContext.pages()[0] : null
    page = reusable || (await browserContext.newPage())
    pagesByKey.set(key, page)
  }
  return page
}

// candidates 안에 같은 텍스트를 가진 "안 보이는" 요소가 같이 있을 수 있어서(.first()만 확인하면
// 그게 안 보인다는 이유로 진짜 보이는 버튼을 건너뛰는 문제가 있었음), 후보마다 실제로 화면에 보이는
// 첫 번째 요소를 끝까지 찾아서 클릭한다.
export async function clickFirstVisible(page, candidates) {
  for (const locator of candidates) {
    const count = await locator.count().catch(() => 0)
    for (let i = 0; i < count; i += 1) {
      const el = locator.nth(i)
      if (await el.isVisible().catch(() => false)) {
        await el.click()
        return true
      }
    }
  }
  return false
}

export function dataUrlToFile(dataUrl, prefix) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || '')
  if (!match) throw new Error('첨부 이미지가 올바른 data URL 형식이 아니에요.')

  const mime = match[1]
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
  fs.mkdirSync(TEMP_DIR, { recursive: true })
  const filePath = path.join(TEMP_DIR, `${prefix}-${Date.now()}.${ext}`)
  fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'))
  return filePath
}

export async function saveErrorScreenshot(page) {
  if (!page) return undefined
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true })
    const screenshotPath = path.join(TEMP_DIR, `instagram-error-${Date.now()}.png`)
    await page.screenshot({ path: screenshotPath })
    return screenshotPath
  } catch {
    return undefined
  }
}
