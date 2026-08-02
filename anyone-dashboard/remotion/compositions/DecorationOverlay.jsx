import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion'

// 코코로 캐릭터 영상에서 본 장식 - 속이 빈 네온 테두리 하트(사진 속 하트 스티커 느낌) +
// 반짝임. 자막 자리(화면 하단 중앙)와 겹치지 않게 가장자리 쪽에만 배치하고, 은은하게
// 위아래로 동동 떠다니면서 반짝이는 정도로만 움직여서 영상 내용을 가리지 않게 함.
const HEART_PATH = 'M12 21s-7.5-4.35-10-8.5C.2 9.5 1 6 4.5 5.3 7 4.8 9 6 12 9c3-3 5-4.2 7.5-3.7C23 6 23.8 9.5 22 12.5 19.5 16.65 12 21 12 21z'
// 리본(나비매듭) 윤곽선 - 하트와 같은 "속이 빈" 라인아트 톤 (2026-07-30, 카드뉴스와 동일 경로)
const RIBBON_PATH = 'M2 6 L12 10 L22 6 L22 18 L12 14 L2 18 Z'

// 2026-07-30: 실제 참고 영상 프레임을 다시 확인해보니(코코로 아이스바나나우유) 하트가 화면
// 전체에 흩뿌려진 게 아니라, 영상 자체가 폴라로이드처럼 검은 배경 위 작은 사진으로 놓이고
// 하트는 그 사진 바깥 여백에 크게 둘러싸듯 배치돼 있었음 - 카드뉴스(server/lib/
// cardImageRenderer.js)에 먼저 재현한 뒤 영상에도 같은 구조로 옮김. 이후 "다른 버전도"
// 요청으로 카드뉴스에 맞춰 4가지 장식 스타일로 늘림. 기존 'full' 배치(화면 전체에 흩뿌림)는
// 폴라로이드 프레임 없이 그냥 장식만 쓰고 싶을 때를 위해 남겨둠.
const ITEMS_FULL = {
  hearts: [
    { type: 'heart', color: 'gold', x: 8, y: 12, size: 84, delay: 0 },
    { type: 'sparkle', x: 88, y: 8, size: 64, delay: 8 },
    { type: 'heart', color: 'rainbow', x: 92, y: 30, size: 78, delay: 16 },
    { type: 'sparkle', x: 5, y: 35, size: 56, delay: 24 },
    { type: 'heart', color: 'gold', x: 90, y: 78, size: 66, delay: 12 },
    { type: 'sparkle', x: 10, y: 82, size: 70, delay: 20 },
  ],
}

// 폴라로이드 프레임(가운데 ~72% 폭) 바깥 여백에 놓이는 배치 - server/lib/cardImageRenderer.js의
// DECORATION_ITEM_SETS와 같은 자리 감각(모서리/상하좌우 여백)을 영상 비율에 맞게 재배치.
const ITEMS_POLAROID = {
  hearts: [
    { type: 'heart', color: 'purple', x: 5, y: 4, size: 70, delay: 0 },
    { type: 'heart', color: 'gold', x: 30, y: 2, size: 56, delay: 10 },
    { type: 'sparkle', x: 88, y: 4, size: 50, delay: 20 },
    { type: 'sparkle', x: 3, y: 30, size: 42, delay: 6 },
    { type: 'heart', color: 'rainbow', x: 90, y: 26, size: 74, delay: 16 },
    { type: 'heart', color: 'gold', x: 4, y: 86, size: 78, delay: 24 },
    { type: 'sparkle', x: 68, y: 90, size: 40, delay: 12 },
    { type: 'heart', color: 'gold', x: 88, y: 88, size: 50, delay: 4 },
  ],
  stars: [
    { type: 'emoji', char: '⭐', x: 6, y: 6, size: 46, glow: '#f9a8d4', delay: 0 },
    { type: 'emoji', char: '💫', x: 30, y: 3, size: 38, glow: '#a5b4fc', delay: 10 },
    { type: 'emoji', char: '🌟', x: 88, y: 4, size: 52, glow: '#fde68a', delay: 20 },
    { type: 'emoji', char: '✨', x: 3, y: 30, size: 34, glow: '#f9a8d4', delay: 6 },
    { type: 'emoji', char: '⭐', x: 90, y: 26, size: 40, glow: '#a5b4fc', delay: 16 },
    { type: 'emoji', char: '🌟', x: 4, y: 86, size: 56, glow: '#fde68a', delay: 24 },
    { type: 'emoji', char: '💫', x: 68, y: 90, size: 32, glow: '#f9a8d4', delay: 12 },
    { type: 'emoji', char: '✨', x: 88, y: 88, size: 38, glow: '#a5b4fc', delay: 4 },
  ],
  ribbon: [
    { type: 'ribbon', color: 'rainbow', x: 6, y: 5, size: 58, delay: 0 },
    { type: 'sparkle', x: 32, y: 3, size: 34, delay: 10 },
    { type: 'ribbon', color: 'gold', x: 88, y: 4, size: 46, delay: 20 },
    { type: 'sparkle', x: 3, y: 30, size: 40, delay: 6 },
    { type: 'ribbon', color: 'rainbow', x: 90, y: 26, size: 70, delay: 16 },
    { type: 'ribbon', color: 'gold', x: 4, y: 86, size: 78, delay: 24 },
    { type: 'sparkle', x: 68, y: 90, size: 34, delay: 12 },
    { type: 'ribbon', color: 'rainbow', x: 88, y: 88, size: 44, delay: 4 },
  ],
  gold: [
    { type: 'emoji', char: '✨', x: 8, y: 6, size: 40, glow: '#fbbf24', delay: 0 },
    { type: 'emoji', char: '⭐', x: 6, y: 55, size: 28, glow: '#fbbf24', delay: 14 },
    { type: 'emoji', char: '✨', x: 88, y: 8, size: 34, glow: '#fbbf24', delay: 20 },
    { type: 'emoji', char: '✨', x: 4, y: 88, size: 38, glow: '#fbbf24', delay: 6 },
    { type: 'emoji', char: '✨', x: 88, y: 85, size: 32, glow: '#fbbf24', delay: 24 },
  ],
}

const FLOAT_PERIOD_FRAMES = 90 // 위아래로 한 번 왕복하는 데 걸리는 프레임 수

// 참고 영상의 네온 하트는 테두리에 은은한 무지개빛이 돌면서도 전체적으로 따뜻한 금색
// 발광이 도는 느낌이라, 단색 대신 gold->orange->pink->gold로 도는 그라데이션을 기본으로 쓰고
// 'rainbow' 타입만 색 범위를 더 넓혀(금색->핑크->보라->시안) 확실히 무지개로 보이게 함.
// 'purple'은 카드뉴스 폴라로이드 버전과 맞춘 보라 계열 하트.
const GRADIENT_STOPS = {
  rainbow: ['#fbbf24', '#f472b6', '#a78bfa', '#22d3ee', '#fbbf24'],
  gold: ['#fde68a', '#fbbf24', '#f59e0b', '#fbbf24', '#fde68a'],
  purple: ['#c084fc', '#a78bfa', '#818cf8', '#a78bfa', '#c084fc'],
}

function OutlineIcon({ path, size, color, gradientId, extra }) {
  const stops = GRADIENT_STOPS[color] || GRADIENT_STOPS.gold
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 0 14px #fbbf24aa)' }}>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          {stops.map((c, i) => (
            <stop key={i} offset={`${(i / (stops.length - 1)) * 100}%`} stopColor={c} />
          ))}
        </linearGradient>
      </defs>
      <path d={path} fill="none" stroke={`url(#${gradientId})`} strokeWidth="1.6" strokeLinejoin="round" />
      {extra ? extra(gradientId) : null}
    </svg>
  )
}

function DecorationItem({ item, index, frame }) {
  const phase = ((frame + item.delay) % FLOAT_PERIOD_FRAMES) / FLOAT_PERIOD_FRAMES
  const floatY = Math.sin(phase * Math.PI * 2) * 12
  const opacity = interpolate(Math.sin(phase * Math.PI * 2), [-1, 1], [0.55, 1])

  let content = '✨'
  if (item.type === 'heart') {
    content = <OutlineIcon path={HEART_PATH} size={item.size} color={item.color} gradientId={`heart-grad-${index}`} />
  } else if (item.type === 'ribbon') {
    content = (
      <OutlineIcon
        path={RIBBON_PATH}
        size={item.size}
        color={item.color}
        gradientId={`ribbon-grad-${index}`}
        extra={(gid) => <circle cx="12" cy="12" r="2.4" fill="none" stroke={`url(#${gid})`} strokeWidth="1.6" />}
      />
    )
  } else if (item.type === 'emoji') {
    content = item.char
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: `${item.x}%`,
        top: `${item.y}%`,
        fontSize: item.size,
        opacity,
        transform: `translateY(${floatY}px)`,
        filter:
          item.type === 'sparkle' || item.type === 'emoji'
            ? `drop-shadow(0 0 12px ${item.glow || 'rgba(255,255,255,0.5)'})`
            : undefined,
      }}
    >
      {content}
    </div>
  )
}

// mode: 'full'(기본, 화면 전체에 흩뿌림) | 'polaroid'(가운데 프레임 바깥 여백에만 배치)
// style: 'hearts' | 'stars' | 'ribbon' | 'gold' (서버 lib/cardImageRenderer.js의 DECORATION_STYLES와 동일)
export function DecorationOverlay({ mode = 'full', style = 'hearts' }) {
  const frame = useCurrentFrame()
  const { width } = useVideoConfig()
  // 세로 영상(쇼츠) 기준 크기로 잡은 emoji size를 실제 영상 폭에 맞게 비례 조정
  const scale = width / 1080
  const table = mode === 'polaroid' ? ITEMS_POLAROID : ITEMS_FULL
  const items = table[style] || table.hearts

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {items.map((item, i) => (
        <DecorationItem key={i} index={i} item={{ ...item, size: item.size * scale }} frame={frame} />
      ))}
    </AbsoluteFill>
  )
}
