// ============================================================
// 영상 제작실용 후킹 썸네일 - 2026-07-27 요청("쇼츠나 롱폼은 후킹 들어간 썸네일도 추천해주면
// 안될까", "상품사진을 이미지로 만들어 넣을 수 있게", "이미지는 뒤로 빼고 앞에 글씨").
// 사진(직접 첨부한 상품 사진, 또는 렌더링된 영상에서 뽑은 장면)을 배경으로 깔고 그 위에
// 후킹 문구를 큼직하게 얹어서 완성된 썸네일 PNG로 합성까지 해서 반환한다 (루나원의
// cardImageRenderer.js와 같은 방식 - 로그인 세션과 무관한 순수 렌더링이라 계정 자동화와
// 완전히 분리됨, 매번 새 headless 인스턴스를 띄우고 끝나면 닫음).
// ============================================================

import { chromium } from 'playwright'

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]))
}

// 2026-08-01: "경제학 똑똑" 등 실제 상위권 경제 유튜브 채널 썸네일을 진희님이 직접 캡처해서
// 벤치마킹 요청 - 기존엔 사진 배경 + 하단에 작게 흰 글씨였는데, 실제 잘 되는 썸네일들의 공통
// 패턴은 완전히 달랐음:
// - 배경을 사진 원본보다 훨씬 어둡게(거의 검정에 가깝게) 눌러서 대비를 극대화
// - 글씨는 흰색 단색이 아니라 핵심 단어 뒤에 "형광펜" 스타일 색 블록을 깔아서 눈에 확 띄게
// - 글씨 위치도 하단 한 줄이 아니라 화면 중상단~중앙에 큼직하게 자리잡음
// - 소재 성격에 따라 강조색이 다름: 경고/위기형 소재는 빨강, 기회/성장형 소재는 노랑·초록
// sentiment: 'warning'(위기/손실 경고 - 빨강 강조) | 'opportunity'(기회/성장 - 노랑 강조, 기본값)
function thumbnailHtml(hook, photoDataUrl, aspect, sentiment = 'opportunity') {
  const [w, h] = aspect === 'horizontal' ? [1280, 720] : [1080, 1920]
  const fontSize = aspect === 'horizontal' ? 92 : 104
  const accentColor = sentiment === 'warning' ? '#ff3b30' : '#ffd60a'
  const accentTextColor = sentiment === 'warning' ? '#fff' : '#1a1200'
  const badgeText = sentiment === 'warning' ? '⚠ 경고' : '🔥 필수 확인'
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif}
    body{width:${w}px;height:${h}px;overflow:hidden}
    .wrap{position:relative;width:${w}px;height:${h}px;background:#000}
    .bg{position:absolute;inset:0;background-size:cover;background-position:center;filter:brightness(.55) saturate(1.1)}
    .overlay{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,.25) 35%,rgba(0,0,0,.75) 100%)}
    .text{position:absolute;left:0;right:0;top:${aspect === 'horizontal' ? '38%' : '30%'};padding:0 ${aspect === 'horizontal' ? '56px' : '48px'};transform:translateY(-50%)}
    h1{display:inline;font-size:${fontSize}px;line-height:1.32;font-weight:900;letter-spacing:-1.5px;word-break:keep-all;
       color:#fff;text-shadow:0 4px 14px rgba(0,0,0,.6);
       background:linear-gradient(to bottom, transparent 62%, ${accentColor} 62%);
       box-decoration-break:clone;-webkit-box-decoration-break:clone}
    .badge{position:absolute;left:${aspect === 'horizontal' ? '56px' : '48px'};top:${aspect === 'horizontal' ? '36px' : '56px'};
       padding:10px 22px;border-radius:8px;background:${accentColor};color:${accentTextColor};font-weight:900;font-size:30px}
  </style></head><body>
    <div class="wrap">
      <div class="bg" style="background-image:url('${photoDataUrl}')"></div>
      <div class="overlay"></div>
      <span class="badge">${badgeText}</span>
      <div class="text"><h1>${escapeHtml(hook)}</h1></div>
    </div>
  </body></html>`
}

// candidates: [{ dataUrl }] - 첨부 사진 또는 영상에서 뽑은 장면
// hooks: 문구 후보 배열, bestIndex: 배경으로 쓸 후보 인덱스
// sentiments: hooks와 같은 길이의 'warning'/'opportunity' 배열(없으면 전부 opportunity로 렌더)
export async function renderThumbnails(hooks, candidates, bestIndex, aspect, sentiments = []) {
  const photoDataUrl = candidates[bestIndex]?.dataUrl || candidates[0]?.dataUrl
  if (!photoDataUrl) throw new Error('썸네일 배경으로 쓸 사진이 없어요.')

  const browser = await chromium.launch({ headless: true })
  try {
    const [w, h] = aspect === 'horizontal' ? [1280, 720] : [1080, 1920]
    const page = await browser.newPage({ viewport: { width: w, height: h } })
    const images = []
    for (let i = 0; i < hooks.length; i += 1) {
      await page.setContent(thumbnailHtml(hooks[i], photoDataUrl, aspect, sentiments[i]), { waitUntil: 'load' })
      const buffer = await page.screenshot({ type: 'png' })
      images.push(`data:image/png;base64,${buffer.toString('base64')}`)
    }
    return images
  } finally {
    await browser.close()
  }
}
