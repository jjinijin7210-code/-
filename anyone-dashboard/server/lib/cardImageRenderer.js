// ============================================================
// 카드뉴스를 텍스트가 아니라 실제 이미지(PNG)로 내려받을 수 있게 렌더링.
// luna-one/server/lib/cardImageRenderer.js에서 그대로 포팅함 (2026-07-29).
//
// 계정 자동화(routes/instagram.js 등)와는 완전히 다른 용도 - 로그인 세션 없이, 그냥 정적
// HTML 한 장을 그려서 사진 찍는 것뿐이라 어떤 계정/세션도 건드리지 않음. 매번 새 headless
// 인스턴스를 띄우고 끝나면 바로 닫아서, 계정 자동화용 영구 브라우저와도 완전히 분리해둠.
// ============================================================

import { chromium } from 'playwright'

const ICON_EMOJI = { boat: '🚢', plane: '✈️', car: '🚗', train: '🚆', map: '🗺️', clock: '⏰', calendar: '📅', ticket: '🎫', money: '💰', star: '⭐', question: '💬', camera: '📷', food: '🍽️', hotel: '🏨' }

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m])
}

const HEART_PATH = 'M12 21s-7.5-4.35-10-8.5C.2 9.5 1 6 4.5 5.3 7 4.8 9 6 12 9c3-3 5-4.2 7.5-3.7C23 6 23.8 9.5 22 12.5 19.5 16.65 12 21 12 21z'
// 리본(나비매듭) 윤곽선 - 두 삼각형이 가운데서 만나는 형태 + 매듭 원. 네온 하트와 같은
// "속이 빈" 라인아트 톤을 맞추려고 채우기 없이 테두리만 그림 (2026-07-30 요청).
const RIBBON_PATH = 'M2 6 L12 10 L22 6 L22 18 L12 14 L2 18 Z'
const HEART_GRADIENT_STOPS = {
  gold: ['#fde68a', '#fbbf24', '#f59e0b', '#fbbf24', '#fde68a'],
  rainbow: ['#fbbf24', '#f472b6', '#a78bfa', '#22d3ee', '#fbbf24'],
}

function outlineSvg(path, size, color, gradientId, rotate = 0, extra = '') {
  const stops = HEART_GRADIENT_STOPS[color] || HEART_GRADIENT_STOPS.gold
  const stopTags = stops.map((c, i) => `<stop offset="${(i / (stops.length - 1)) * 100}%" stop-color="${c}"/>`).join('')
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="filter:drop-shadow(0 0 14px #fbbf24aa);transform:rotate(${rotate}deg)">
    <defs><linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">${stopTags}</linearGradient></defs>
    <path d="${path}" fill="none" stroke="url(#${gradientId})" stroke-width="1.6" stroke-linejoin="round"/>
    ${extra}
  </svg>`
}
function heartSvg(size, color, gradientId, rotate = 0) {
  return outlineSvg(HEART_PATH, size, color, gradientId, rotate)
}
function ribbonSvg(size, color, gradientId, rotate = 0) {
  const extra = `<circle cx="12" cy="12" r="2.4" fill="none" stroke="url(#${gradientId})" stroke-width="1.6"/>`
  return outlineSvg(RIBBON_PATH, size, color, gradientId, rotate, extra)
}

// 2026-07-29 요청, Video Studio와 같은 느낌 - 속이 빈 네온 테두리 하트. 정지 이미지라
// 애니메이션 없이 위쪽 절반에만 흩뿌림(기존 전체 사진 오버레이 버전, decoration='hearts'
// 초기 구현).
const DECORATION_ITEMS = [
  { type: 'heart', color: 'gold', x: 10, y: 8, size: 76, rotate: -8 },
  { type: 'sparkle', x: 40, y: 5, size: 60 },
  { type: 'heart', color: 'rainbow', x: 78, y: 20, size: 70, rotate: 10 },
  { type: 'sparkle', x: 6, y: 32, size: 52 },
  { type: 'heart', color: 'gold', x: 88, y: 38, size: 60, rotate: -6 },
]

function decorationHtml(items) {
  return items.map((item, i) => {
    if (item.type === 'sparkle') {
      return `<span class="decoration" style="left:${item.x}%;top:${item.y}%;font-size:${item.size}px">✨</span>`
    }
    if (item.type === 'emoji') {
      const glow = item.glow ? `filter:drop-shadow(0 0 14px ${item.glow})` : ''
      return `<span class="decoration" style="left:${item.x}%;top:${item.y}%;font-size:${item.size}px;${glow};transform:rotate(${item.rotate || 0}deg)">${item.char}</span>`
    }
    if (item.type === 'ribbon') {
      return `<span class="decoration" style="left:${item.x}%;top:${item.y}%">${ribbonSvg(item.size, item.color, `ribbon-grad-${i}`, item.rotate)}</span>`
    }
    return `<span class="decoration" style="left:${item.x}%;top:${item.y}%">${heartSvg(item.size, item.color, `heart-grad-${i}`, item.rotate)}</span>`
  }).join('')
}

const FONT_STACK = "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif"

function iconOrPhotoBg(photoDataUrl, icon, iconFontSize) {
  return photoDataUrl
    ? `<div class="bg" style="background-image:url('${photoDataUrl}')"></div><div class="overlay"></div>`
    : `<div class="bg icon-bg"><span class="icon" style="font-size:${iconFontSize}px">${ICON_EMOJI[icon] || '⭐'}</span></div>`
}

// 2026-07-30 "다른 카드뉴스 벤치마킹해서 스타일 고를 수 있게" 요청 - luna-one/server/lib/
// cardImageRenderer.js에서 그대로 포팅함(같은 7개 템플릿, 같은 로직) + 실제 인기 카드뉴스에서
// 자주 보이는 색 조합 3개(다크 네이비/민트/코랄) 추가.
export const CARD_TEMPLATES = [
  { id: 'neon', label: '네온 그라데이션', desc: '보라 톤, 배지+포인트 컬러 바' },
  { id: 'minimal', label: '미니멀 화이트', desc: '여백 넉넉, 세리프 헤드라인, 신뢰감' },
  { id: 'magazine', label: '매거진 볼드', desc: '흑백 대비, 큰 숫자 배지, 편집샵 느낌' },
  { id: 'pastel', label: '파스텔 소프트', desc: '부드러운 그라데이션, 친근한 톤' },
  { id: 'navy', label: '다크 네이비', desc: '남색+골드 포인트, 신뢰감 있는 정보성 톤' },
  { id: 'mint', label: '민트 프레시', desc: '민트 톤, 둥근 배지, 친근한 라이프스타일 느낌' },
  { id: 'coral', label: '코랄 팝', desc: '코랄-오렌지 그라데이션, 활기찬 후킹형' },
]

// 요즘 카드뉴스에서 자주 보이는 스타일 - 굵은 대형 헤드라인, 사진 위 어두운 그라데이션으로
// 글씨 가독성 확보, 우측 상단 페이지 배지, 하단 포인트 컬러 바.
function neonTemplate(card, index, total, photoDataUrl) {
  const v = card.visual || {}
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:${FONT_STACK}}
    body{width:1080px;height:1080px;overflow:hidden}
    .card{position:relative;width:1080px;height:1080px;background:linear-gradient(155deg,#1b1030,#3a1257 55%,#0e0a1a)}
    .bg{position:absolute;inset:0;background-size:cover;background-position:center}
    .icon-bg{display:flex;align-items:center;justify-content:center}
    .icon-bg .icon{opacity:.9}
    .overlay{position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,6,20,.15) 0%,rgba(10,6,20,.55) 55%,rgba(10,6,20,.92) 100%)}
    .content{position:absolute;left:0;right:0;bottom:50px;padding:64px 64px 76px;color:#fff}
    .badge{display:inline-block;padding:10px 22px;border-radius:999px;background:linear-gradient(90deg,#7c3aed,#e879f9);font-size:26px;font-weight:800;letter-spacing:.5px;margin-bottom:28px}
    h1{font-size:64px;line-height:1.28;font-weight:800;letter-spacing:-1px;margin-bottom:22px;text-shadow:0 4px 18px rgba(0,0,0,.35)}
    p{font-size:32px;line-height:1.55;color:#e9e2f2;font-weight:500}
    .page{position:absolute;top:48px;right:56px;font-size:26px;font-weight:700;color:#fff;background:rgba(255,255,255,.16);padding:10px 22px;border-radius:999px;backdrop-filter:blur(6px)}
    .accent{position:absolute;left:0;bottom:0;width:100%;height:10px;background:linear-gradient(90deg,#7c3aed,#e879f9,#7c3aed)}
  </style></head><body>
    <div class="card">
      ${iconOrPhotoBg(photoDataUrl, v.icon, 220)}
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

// 여백 넉넉한 화이트 배경 + 세리프 헤드라인 - 신뢰감/정보성 콘텐츠에 어울리는 톤.
function minimalTemplate(card, index, total, photoDataUrl) {
  const bg = photoDataUrl
    ? `<div class="photo" style="background-image:url('${photoDataUrl}')"></div>`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:${FONT_STACK}}
    body{width:1080px;height:1080px;overflow:hidden}
    .card{position:relative;width:1080px;height:1080px;background:#fdfcfa}
    .photo{position:absolute;top:0;left:0;right:0;height:520px;background-size:cover;background-position:center}
    .topbar{position:absolute;top:0;left:0;right:0;height:10px;background:#1a1a1a}
    .page{position:absolute;top:36px;right:40px;font-size:22px;font-weight:500;color:#999}
    .content{position:absolute;left:64px;right:64px;bottom:120px}
    .point{font-size:20px;font-weight:500;color:#1a1a1a;letter-spacing:2px;margin-bottom:20px}
    h1{font-family:Georgia,'Noto Serif KR',serif;font-size:56px;line-height:1.35;color:#1a1a1a;margin-bottom:22px;font-weight:700}
    p{font-size:28px;line-height:1.65;color:#666}
  </style></head><body>
    <div class="card">
      <div class="topbar"></div>
      ${bg}
      <span class="page">${index + 1} / ${total}</span>
      <div class="content">
        <div class="point">POINT ${String(index + 1).padStart(2, '0')}</div>
        <h1>${escapeHtml(card.headline)}</h1>
        <p>${escapeHtml(card.body)}</p>
      </div>
    </div>
  </body></html>`
}

// 흑백 대비 + 큰 숫자 배지 - 편집샵/매거진 느낌, 임팩트 있는 후킹용.
function magazineTemplate(card, index, total, photoDataUrl) {
  const v = card.visual || {}
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:${FONT_STACK}}
    body{width:1080px;height:1080px;overflow:hidden}
    .card{position:relative;width:1080px;height:1080px;background:linear-gradient(160deg,#2a2a2a,#0a0a0a)}
    .bg{position:absolute;inset:0;background-size:cover;background-position:center;opacity:.55}
    .icon-bg{display:flex;align-items:center;justify-content:center;opacity:.35}
    .badge{position:absolute;top:56px;left:56px;width:88px;height:88px;border-radius:50%;background:#f4d03f;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:700;color:#1a1a1a}
    .content{position:absolute;left:56px;right:56px;bottom:124px}
    h1{font-size:60px;line-height:1.25;font-weight:700;color:#fff;margin-bottom:20px}
    .rule{width:64px;height:5px;background:#f4d03f;margin-bottom:22px}
    p{font-size:28px;line-height:1.6;color:#ccc}
    .page{position:absolute;top:56px;right:56px;font-size:22px;font-weight:500;color:#888}
  </style></head><body>
    <div class="card">
      ${photoDataUrl ? `<div class="bg" style="background-image:url('${photoDataUrl}')"></div>` : `<div class="bg icon-bg" style="display:flex;align-items:center;justify-content:center;font-size:260px">${ICON_EMOJI[v.icon] || '⭐'}</div>`}
      <span class="page">${index + 1} / ${total}</span>
      <div class="badge">${String(index + 1).padStart(2, '0')}</div>
      <div class="content">
        <h1>${escapeHtml(card.headline)}</h1>
        <div class="rule"></div>
        <p>${escapeHtml(card.body)}</p>
      </div>
    </div>
  </body></html>`
}

// 부드러운 파스텔 그라데이션 + 둥근 배지 - 친근한 톤, 라이프스타일/후기 콘텐츠에 어울림.
function pastelTemplate(card, index, total, photoDataUrl) {
  const v = card.visual || {}
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:${FONT_STACK}}
    body{width:1080px;height:1080px;overflow:hidden}
    .card{position:relative;width:1080px;height:1080px;background:linear-gradient(150deg,#ffe8d6,#fdd6e0 50%,#e0d4fa)}
    .bg{position:absolute;inset:0;background-size:cover;background-position:center;opacity:.9}
    .icon-bg{display:flex;align-items:center;justify-content:center}
    .icon-bg .icon{opacity:.85}
    .badge{position:absolute;top:48px;right:48px;background:rgba(255,255,255,.75);padding:10px 24px;border-radius:999px;font-size:24px;font-weight:600;color:#a34d6b}
    .content{position:absolute;left:64px;right:64px;bottom:124px}
    h1{font-size:56px;line-height:1.35;font-weight:600;color:#5a3a4a;margin-bottom:22px}
    p{font-size:28px;line-height:1.6;color:#7a5a68}
  </style></head><body>
    <div class="card">
      ${iconOrPhotoBg(photoDataUrl, v.icon, 220)}
      <span class="badge">TIP ${index + 1}</span>
      <div class="content">
        <h1>${escapeHtml(card.headline)}</h1>
        <p>${escapeHtml(card.body)}</p>
      </div>
    </div>
  </body></html>`
}

// 남색 + 골드 포인트 - 신뢰감 있는 정보성/시사 톤 카드뉴스에서 자주 보이는 조합.
function navyTemplate(card, index, total, photoDataUrl) {
  const v = card.visual || {}
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:${FONT_STACK}}
    body{width:1080px;height:1080px;overflow:hidden}
    .card{position:relative;width:1080px;height:1080px;background:linear-gradient(160deg,#0a1628,#142b4f 60%,#0a1628)}
    .bg{position:absolute;inset:0;background-size:cover;background-position:center;opacity:.5}
    .icon-bg{display:flex;align-items:center;justify-content:center;opacity:.5}
    .badge{position:absolute;top:48px;right:56px;border:1px solid #d4af37;padding:8px 20px;border-radius:4px;font-size:22px;font-weight:600;color:#d4af37;letter-spacing:1px}
    .content{position:absolute;left:64px;right:64px;bottom:124px}
    .rule{width:56px;height:3px;background:#d4af37;margin-bottom:20px}
    h1{font-size:58px;line-height:1.32;font-weight:700;color:#fff;margin-bottom:20px}
    p{font-size:28px;line-height:1.6;color:#c3cbdc}
  </style></head><body>
    <div class="card">
      ${iconOrPhotoBg(photoDataUrl, v.icon, 220)}
      <span class="badge">${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span>
      <div class="content">
        <div class="rule"></div>
        <h1>${escapeHtml(card.headline)}</h1>
        <p>${escapeHtml(card.body)}</p>
      </div>
    </div>
  </body></html>`
}

// 민트 톤 + 둥근 배지 - 친근한 라이프스타일/꿀팁 카드뉴스에서 자주 보이는 조합.
function mintTemplate(card, index, total, photoDataUrl) {
  const v = card.visual || {}
  const bg = photoDataUrl
    ? `<div class="photo" style="background-image:url('${photoDataUrl}')"></div>`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:${FONT_STACK}}
    body{width:1080px;height:1080px;overflow:hidden}
    .card{position:relative;width:1080px;height:1080px;background:linear-gradient(155deg,#eafaf3,#c9f0e0)}
    .photo{position:absolute;top:56px;left:56px;right:56px;height:480px;border-radius:24px;background-size:cover;background-position:center;box-shadow:0 16px 40px rgba(13,92,79,.18)}
    .icon-bg{position:absolute;top:56px;left:56px;right:56px;height:480px;border-radius:24px;background:#fff;display:flex;align-items:center;justify-content:center}
    .icon-bg .icon{font-size:200px}
    .badge{position:absolute;top:80px;right:80px;background:#0d5c4f;padding:9px 22px;border-radius:999px;font-size:22px;font-weight:700;color:#eafaf3}
    .content{position:absolute;left:64px;right:64px;bottom:120px}
    h1{font-size:52px;line-height:1.35;font-weight:700;color:#0d5c4f;margin-bottom:18px}
    p{font-size:28px;line-height:1.6;color:#3a6b60}
  </style></head><body>
    <div class="card">
      ${bg || `<div class="icon-bg"><span class="icon">${ICON_EMOJI[v.icon] || '⭐'}</span></div>`}
      <span class="badge">TIP ${index + 1}</span>
      <div class="content">
        <h1>${escapeHtml(card.headline)}</h1>
        <p>${escapeHtml(card.body)}</p>
      </div>
    </div>
  </body></html>`
}

// 코랄-오렌지 그라데이션 + 굵은 흰 글씨 - 활기차고 눈에 띄는 후킹형 카드뉴스 조합.
function coralTemplate(card, index, total, photoDataUrl) {
  const v = card.visual || {}
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:${FONT_STACK}}
    body{width:1080px;height:1080px;overflow:hidden}
    .card{position:relative;width:1080px;height:1080px;background:linear-gradient(150deg,#ff9966,#ff5e62)}
    .bg{position:absolute;inset:0;background-size:cover;background-position:center;opacity:.65}
    .overlay{position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,94,98,0) 0%,rgba(200,40,50,.55) 100%)}
    .icon-bg{display:flex;align-items:center;justify-content:center}
    .icon-bg .icon{font-size:220px;opacity:.9}
    .badge{position:absolute;top:48px;right:56px;background:rgba(255,255,255,.9);padding:9px 22px;border-radius:999px;font-size:24px;font-weight:800;color:#ff5e3a}
    .content{position:absolute;left:64px;right:64px;bottom:124px}
    h1{font-size:62px;line-height:1.28;font-weight:800;color:#fff;margin-bottom:20px;text-shadow:0 4px 16px rgba(0,0,0,.25)}
    p{font-size:30px;line-height:1.55;color:#fff0ea;font-weight:600}
  </style></head><body>
    <div class="card">
      ${photoDataUrl ? `<div class="bg" style="background-image:url('${photoDataUrl}')"></div><div class="overlay"></div>` : `<div class="bg icon-bg"><span class="icon">${ICON_EMOJI[v.icon] || '⭐'}</span></div>`}
      <span class="badge">${index + 1}</span>
      <div class="content">
        <h1>${escapeHtml(card.headline)}</h1>
        <p>${escapeHtml(card.body)}</p>
      </div>
    </div>
  </body></html>`
}

const TEMPLATE_FN = {
  neon: neonTemplate,
  minimal: minimalTemplate,
  magazine: magazineTemplate,
  pastel: pastelTemplate,
  navy: navyTemplate,
  mint: mintTemplate,
  coral: coralTemplate,
}

// 2026-07-30 요청: "코코로 영상에서 본 것처럼 더 리얼하게" - 실제 참고 영상(코코로 아이스바
// 나나우유) 프레임을 직접 확인해보니, 하트가 사진 위에 흩뿌려진 게 아니라 사진 자체가 살짝
// 기울어진 폴라로이드 형태로 검은 배경 위에 놓이고, 하트·반짝임은 폴라로이드 바깥 검은
// 여백에 크게 둘러싸듯 배치돼 있었음 - 그 구조를 그대로 재현함.
// purple은 gold/rainbow 그라데이션 팔레트에 없어서 별도 등록 (참고 영상 속 보라 하트 재현)
HEART_GRADIENT_STOPS.purple = ['#c084fc', '#a78bfa', '#818cf8', '#a78bfa', '#c084fc']

// 2026-07-30 "다른 버전도 넣어줘" 요청 - 네온 하트 하나뿐이던 걸 4가지 장식 스타일로 늘림.
// 프론트 드롭다운에 그대로 쓰는 목록(id는 renderCardsToImages()의 decoration 인자와 일치).
export const DECORATION_STYLES = [
  { id: 'none', label: '없음' },
  { id: 'neonCyber', label: '🔮 사이버 네온 글로우' },
  { id: 'hearts', label: '네온 하트' },
  { id: 'stars', label: '파스텔 별' },
  { id: 'ribbon', label: '리본 큐트' },
  { id: 'gold', label: '골드 럭셔리' },
]

const DECORATION_ITEM_SETS = {
  hearts: [
    { type: 'heart', color: 'purple', x: 5, y: 4, size: 110, rotate: -12 },
    { type: 'heart', color: 'gold', x: 30, y: 2, size: 90, rotate: 8 },
    { type: 'sparkle', x: 90, y: 6, size: 76 },
    { type: 'sparkle', x: 3, y: 34, size: 60 },
    { type: 'heart', color: 'rainbow', x: 90, y: 30, size: 120, rotate: 10 },
    { type: 'heart', color: 'gold', x: 4, y: 84, size: 130, rotate: -10 },
    { type: 'sparkle', x: 68, y: 88, size: 56 },
    { type: 'heart', color: 'gold', x: 88, y: 90, size: 70, rotate: 6 },
  ],
  stars: [
    { type: 'emoji', char: '⭐', x: 6, y: 6, size: 70, glow: '#f9a8d4' },
    { type: 'emoji', char: '💫', x: 30, y: 3, size: 56, glow: '#a5b4fc' },
    { type: 'emoji', char: '🌟', x: 90, y: 8, size: 80, glow: '#fde68a' },
    { type: 'emoji', char: '✨', x: 4, y: 32, size: 50, glow: '#f9a8d4' },
    { type: 'emoji', char: '⭐', x: 92, y: 28, size: 60, glow: '#a5b4fc' },
    { type: 'emoji', char: '🌟', x: 5, y: 85, size: 84, glow: '#fde68a' },
    { type: 'emoji', char: '💫', x: 68, y: 90, size: 48, glow: '#f9a8d4' },
    { type: 'emoji', char: '✨', x: 88, y: 88, size: 56, glow: '#a5b4fc' },
  ],
  ribbon: [
    { type: 'ribbon', color: 'rainbow', x: 6, y: 5, size: 90, rotate: -10 },
    { type: 'sparkle', x: 32, y: 3, size: 50 },
    { type: 'ribbon', color: 'gold', x: 88, y: 8, size: 70, rotate: 8 },
    { type: 'sparkle', x: 3, y: 34, size: 60 },
    { type: 'ribbon', color: 'rainbow', x: 90, y: 28, size: 110, rotate: 10 },
    { type: 'ribbon', color: 'gold', x: 4, y: 84, size: 120, rotate: -8 },
    { type: 'sparkle', x: 68, y: 90, size: 50 },
    { type: 'ribbon', color: 'rainbow', x: 88, y: 88, size: 66, rotate: 6 },
  ],
  gold: [
    { type: 'emoji', char: '✨', x: 8, y: 6, size: 60, glow: '#fbbf24' },
    { type: 'emoji', char: '⭐', x: 6, y: 55, size: 40, glow: '#fbbf24' },
    { type: 'emoji', char: '✨', x: 90, y: 10, size: 50, glow: '#fbbf24' },
    { type: 'emoji', char: '✨', x: 5, y: 88, size: 56, glow: '#fbbf24' },
    { type: 'emoji', char: '✨', x: 90, y: 85, size: 46, glow: '#fbbf24' },
  ],
  neonCyber: [
    { type: 'emoji', char: '🔮', x: 8, y: 6, size: 70, glow: '#ec4899' },
    { type: 'emoji', char: '⚡', x: 90, y: 10, size: 65, glow: '#00f3ff' },
    { type: 'emoji', char: '✨', x: 6, y: 88, size: 60, glow: '#ec4899' },
    { type: 'emoji', char: '🔮', x: 88, y: 85, size: 65, glow: '#00f3ff' },
  ],
}

function cardHtmlPolaroid(card, index, total, photoDataUrl, decoration) {
  const v = card.visual || {}
  const photo = photoDataUrl
    ? `<div class="photo" style="background-image:url('${photoDataUrl}')"></div>`
    : `<div class="photo icon-bg"><span class="icon">${ICON_EMOJI[v.icon] || '⭐'}</span></div>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif}
    body{width:1080px;height:1080px;overflow:hidden}
    .card{position:relative;width:1080px;height:1080px;background:#050505}
    .decoration{position:absolute}
    .polaroid{position:absolute;left:50%;top:410px;width:700px;transform:translate(-50%,-50%) rotate(-5deg);
      background:#fff;padding:22px 22px 110px;box-shadow:0 24px 70px rgba(0,0,0,.7)}
    .photo{width:100%;height:660px;background-size:cover;background-position:center}
    .icon-bg{display:flex;align-items:center;justify-content:center;background:#f4f0f8}
    .icon-bg .icon{font-size:200px}
    .page{position:absolute;top:40px;right:48px;font-size:24px;font-weight:700;color:#fff;background:rgba(255,255,255,.14);padding:9px 20px;border-radius:999px}
    .content{position:absolute;left:64px;right:64px;bottom:100px;color:#fff;text-align:center}
    .badge{display:inline-block;padding:9px 20px;border-radius:999px;background:linear-gradient(90deg,#7c3aed,#e879f9);font-size:22px;font-weight:800;letter-spacing:.5px;margin-bottom:18px}
    h1{font-size:48px;line-height:1.3;font-weight:800;margin-bottom:14px;text-shadow:0 2px 12px rgba(0,0,0,.6)}
    p{font-size:26px;line-height:1.5;color:#e9e2f2;font-weight:500}
  </style></head><body>
    <div class="card">
      ${decorationHtml(DECORATION_ITEM_SETS[decoration] || DECORATION_ITEM_SETS.hearts)}
      <div class="polaroid">${photo}</div>
      <span class="page">${index + 1} / ${total}</span>
      <div class="content">
        <span class="badge">POINT ${index + 1}</span>
        <h1>${escapeHtml(card.headline)}</h1>
        <p>${escapeHtml(card.body)}</p>
      </div>
    </div>
  </body></html>`
}

function cardHtml(card, index, total, photoDataUrl, decoration, template) {
  if (decoration && decoration !== 'none') return cardHtmlPolaroid(card, index, total, photoDataUrl, decoration)
  const fn = TEMPLATE_FN[template] || neonTemplate
  return fn(card, index, total, photoDataUrl)
}

// cards: [{page, headline, body, visual:{type,photoIndex,icon}}]
// photos: [{dataUrl}] - 프론트에서 이미 갖고 있는 첨부 사진 그대로 전달받음
// decoration: 'hearts'|'stars'|'ribbon'|'gold' 중 하나면 템플릿 선택과 무관하게 폴라로이드+장식
// 레이아웃으로 렌더링. template: CARD_TEMPLATES의 id 중 하나(없으면 네온 그라데이션 기본형).
export async function renderCardsToImages(cards, photos, decoration, template) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } })
    const images = []
    for (let i = 0; i < cards.length; i += 1) {
      const card = cards[i]
      const v = card.visual || {}
      const photoDataUrl = v.type === 'photo' ? photos?.[v.photoIndex]?.dataUrl : null
      await page.setContent(cardHtml(card, i, cards.length, photoDataUrl, decoration, template), { waitUntil: 'load' })
      const buffer = await page.screenshot({ type: 'png' })
      images.push(`data:image/png;base64,${buffer.toString('base64')}`)
    }
    return images
  } finally {
    await browser.close()
  }
}
