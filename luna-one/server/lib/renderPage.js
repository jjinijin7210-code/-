// ============================================================
// 토스쇼핑·네이버쇼핑처럼 JS로 본문을 그려주는 SPA 페이지는 순수 fetch()로는 빈 껍데기만
// 받아져서 Readability가 본문을 못 찾는 문제(2026-07-29 확인) - headless Chromium으로
// 실제 렌더링된 HTML을 받아와서 해결한다.
//
// localBrowser.js(로그인 세션을 유지하는 headed 브라우저, 네이버 블로그 자동화 전용)와는
// 완전히 다른 용도 - 로그인 없이 공개 페이지를 그냥 읽기만 하는 거라, 매번 새 headless
// 인스턴스를 띄우고 끝나면 바로 닫는다 (cardImageRenderer.js와 동일한 원칙).
// ============================================================

import { chromium } from 'playwright'

// url을 렌더링해서 완성된 HTML 문자열을 돌려줌
export async function renderPageHtml(url) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ userAgent: 'Mozilla/5.0 LunaOne/1.0' })
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })
    return await page.content()
  } finally {
    await browser.close()
  }
}
