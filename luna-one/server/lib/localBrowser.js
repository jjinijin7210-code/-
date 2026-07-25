// ============================================================
// 로컬 전용 브라우저 자동화 - anyone-dashboard의 검증된 패턴 재사용.
// 제목/본문(+이미지)만 채우고, 로그인과 마지막 "발행" 버튼은 항상 사람이 직접 한다.
// Render 같은 배포 서버에는 화면(display)이 없어서 동작 안 함 - 로컬 실행 전용.
// ============================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

// anyone-dashboard와 같은 프로필을 공유하면 두 프로그램을 동시에 켰을 때 프로필 잠금 충돌이
// 날 수 있어서, luna-one 전용 프로필 디렉터리를 따로 씀 (처음 한 번은 네이버 로그인을 다시 해야 함)
export const PROFILE_DIR = path.join(os.homedir(), '.luna-one-browser-profile')
export const TEMP_DIR = path.join(os.tmpdir(), 'luna-one-browser')

let browserContext = null
const pagesByKey = new Map()

export function ensureLocalAutomationEnabled() {
  if (process.env.ENABLE_LOCAL_BROWSER_AUTOMATION !== 'true') {
    throw new Error('로컬 브라우저 자동화가 꺼져 있어요. .env에 ENABLE_LOCAL_BROWSER_AUTOMATION=true를 추가해주세요.')
  }
}

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
    const reusable = pagesByKey.size === 0 ? browserContext.pages()[0] : null
    page = reusable || (await browserContext.newPage())
    pagesByKey.set(key, page)
  }
  return page
}

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
    const screenshotPath = path.join(TEMP_DIR, `naverblog-error-${Date.now()}.png`)
    await page.screenshot({ path: screenshotPath })
    return screenshotPath
  } catch {
    return undefined
  }
}
