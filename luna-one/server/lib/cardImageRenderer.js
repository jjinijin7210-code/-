// ============================================================
// 카드뉴스를 텍스트가 아니라 실제 이미지(PNG)로 내려받을 수 있게 렌더링.
// 2026-07-27 요청: "카드뉴스는 메모장으로 받으니 좀 그러네... 유행하고 트렌디한 스타일로"
// - 화면 미리보기(.news-card)와 비슷하지만 더 트렌디하게(굵은 타이포, 그라데이션 오버레이,
// 여백)를 새로 만든 HTML/CSS를 헤드리스 Chromium으로 한 장씩 스크린샷 떠서 PNG로 반환함.
//
// 계정 자동화(routes/instagram.js 등)와는 완전히 다른 용도 - 로그인 세션 없이, 그냥 정적
// HTML 한 장을 그려서 사진 찍는 것뿐이라 어떤 계정/세션도 건드리지 않음. 매번 새 headless
// 인스턴스를 띄우고 끝나면 바로 닫아서, 계정 자동화용 영구 브라우저(localBrowser.js)와도
// 완전히 분리해둠.
// ============================================================

import { chromium } from 'playwright'

const ICON_EMOJI = { boat: '🚢', plane: '✈️', car: '🚗', train: '🚆', map: '🗺️', clock: '⏰', calendar: '📅', ticket: '🎫', money: '💰', star: '⭐', question: '💬', camera: '📷', food: '🍽️', hotel: '🏨' }

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m])
}

// 요즘 카드뉴스에서 자주 보이는 스타일 - 굵은 대형 헤드라인, 사진 위 어두운 그라데이션으로
// 글씨 가독성 확보, 우측 상단 페이지 배지, 하단 포인트 컬러 바.
function cardHtml(card, index, total, photoDataUrl) {
  const v = card.visual || {}
  const bg = photoDataUrl
    ? `<div class="bg" style="background-image:url('${photoDataUrl}')"></div><div class="overlay"></div>`
    : `<div class="bg icon-bg"><span class="icon">${ICON_EMOJI[v.icon] || '⭐'}</span></div>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif}
    body{width:1080px;height:1080px;overflow:hidden}
    .card{position:relative;width:1080px;height:1080px;background:linear-gradient(155deg,#1b1030,#3a1257 55%,#0e0a1a)}
    .bg{position:absolute;inset:0;background-size:cover;background-position:center}
    .icon-bg{display:flex;align-items:center;justify-content:center}
    .icon-bg .icon{font-size:220px;opacity:.9}
    .overlay{position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,6,20,.15) 0%,rgba(10,6,20,.55) 55%,rgba(10,6,20,.92) 100%)}
    .content{position:absolute;left:0;right:0;bottom:0;padding:64px 64px 76px;color:#fff}
    .badge{display:inline-block;padding:10px 22px;border-radius:999px;background:linear-gradient(90deg,#7c3aed,#e879f9);font-size:26px;font-weight:800;letter-spacing:.5px;margin-bottom:28px}
    h1{font-size:64px;line-height:1.28;font-weight:800;letter-spacing:-1px;margin-bottom:22px;text-shadow:0 4px 18px rgba(0,0,0,.35)}
    p{font-size:32px;line-height:1.55;color:#e9e2f2;font-weight:500}
    .page{position:absolute;top:48px;right:56px;font-size:26px;font-weight:700;color:#fff;background:rgba(255,255,255,.16);padding:10px 22px;border-radius:999px;backdrop-filter:blur(6px)}
    .accent{position:absolute;left:0;bottom:0;width:100%;height:10px;background:linear-gradient(90deg,#7c3aed,#e879f9,#7c3aed)}
  </style></head><body>
    <div class="card">
      ${bg}
      <span class="page">${index + 1} / ${total}</span>
      <div class="content">
        <span class="badge">POINT ${index + 1}</span>
        <h1>${escapeHtml(card.headline)}</h1>
        <p>${escapeHtml(card.body)}</p>
      </div>
      <div class="accent"></div>
    </div>
  </body></html>`
}

// cards: [{page, headline, body, visual:{type,photoIndex,icon}}]
// photos: [{dataUrl}] - 프론트에서 이미 갖고 있는 첨부 사진 그대로 전달받음
export async function renderCardsToImages(cards, photos) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } })
    const images = []
    for (let i = 0; i < cards.length; i += 1) {
      const card = cards[i]
      const v = card.visual || {}
      const photoDataUrl = v.type === 'photo' ? photos?.[v.photoIndex]?.dataUrl : null
      await page.setContent(cardHtml(card, i, cards.length, photoDataUrl), { waitUntil: 'load' })
      const buffer = await page.screenshot({ type: 'png' })
      images.push(`data:image/png;base64,${buffer.toString('base64')}`)
    }
    return images
  } finally {
    await browser.close()
  }
}
