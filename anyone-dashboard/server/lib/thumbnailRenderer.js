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

// aspect: 'vertical'(쇼츠, 1080x1920) | 'horizontal'(롱폼, 1280x720)
function thumbnailHtml(hook, photoDataUrl, aspect) {
  const [w, h] = aspect === 'horizontal' ? [1280, 720] : [1080, 1920]
  const fontSize = aspect === 'horizontal' ? 88 : 96
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif}
    body{width:${w}px;height:${h}px;overflow:hidden}
    .wrap{position:relative;width:${w}px;height:${h}px;background:#111}
    .bg{position:absolute;inset:0;background-size:cover;background-position:center}
    .overlay{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.05) 0%,rgba(0,0,0,.15) 40%,rgba(0,0,0,.75) 100%)}
    .text{position:absolute;left:0;right:0;bottom:0;padding:${aspect === 'horizontal' ? '50px 60px' : '70px 56px'};}
    h1{color:#fff;font-size:${fontSize}px;line-height:1.22;font-weight:900;letter-spacing:-1.5px;text-shadow:0 6px 24px rgba(0,0,0,.55);word-break:keep-all}
    .accent{position:absolute;left:56px;top:${aspect === 'horizontal' ? '40px' : '60px'};padding:10px 24px;border-radius:999px;background:linear-gradient(90deg,#ff3d6e,#ff8a3d);color:#fff;font-weight:800;font-size:28px}
  </style></head><body>
    <div class="wrap">
      <div class="bg" style="background-image:url('${photoDataUrl}')"></div>
      <div class="overlay"></div>
      <span class="accent">MUST SEE</span>
      <div class="text"><h1>${escapeHtml(hook)}</h1></div>
    </div>
  </body></html>`
}

// candidates: [{ dataUrl }] - 첨부 사진 또는 영상에서 뽑은 장면
// hooks: 문구 후보 배열, bestIndex: 배경으로 쓸 후보 인덱스
export async function renderThumbnails(hooks, candidates, bestIndex, aspect) {
  const photoDataUrl = candidates[bestIndex]?.dataUrl || candidates[0]?.dataUrl
  if (!photoDataUrl) throw new Error('썸네일 배경으로 쓸 사진이 없어요.')

  const browser = await chromium.launch({ headless: true })
  try {
    const [w, h] = aspect === 'horizontal' ? [1280, 720] : [1080, 1920]
    const page = await browser.newPage({ viewport: { width: w, height: h } })
    const images = []
    for (const hook of hooks) {
      await page.setContent(thumbnailHtml(hook, photoDataUrl, aspect), { waitUntil: 'load' })
      const buffer = await page.screenshot({ type: 'png' })
      images.push(`data:image/png;base64,${buffer.toString('base64')}`)
    }
    return images
  } finally {
    await browser.close()
  }
}
