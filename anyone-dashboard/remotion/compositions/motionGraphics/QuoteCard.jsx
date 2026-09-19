import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { FONT_STACK, scaleUnit } from './shared.js'

// 짧은 문구를 강조하는 인용구 카드.
// props: { quote, author } + 공통 { brandColor }
export function QuoteCard({ quote = '기록은 기억을 이긴다', author = '', brandColor = '#ec4899' }) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const u = scaleUnit(width, height)

  const markIn = spring({ frame, fps, config: { damping: 11, stiffness: 130 } })
  const quoteIn = spring({ frame: frame - Math.round(fps * 0.3), fps, config: { damping: 15 } })
  const authorIn = spring({ frame: frame - Math.round(fps * 0.8), fps, config: { damping: 15 } })
  // 은은하게 숨쉬는 배경 그라데이션 (정지화면처럼 안 보이게)
  const glow = interpolate(Math.sin(frame / (fps * 1.2)), [-1, 1], [0.25, 0.45])

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 30% 20%, ${brandColor}${Math.round(glow * 255).toString(16).padStart(2, '0')} 0%, #10101c 65%)`,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT_STACK,
        color: '#ffffff',
        padding: 90 * u,
      }}
    >
      <div
        style={{
          fontSize: 200 * u,
          fontWeight: 900,
          color: brandColor,
          lineHeight: 0.6,
          transform: `scale(${markIn})`,
          marginBottom: 20 * u,
        }}
      >
        “
      </div>
      <div
        style={{
          fontSize: 64 * u,
          fontWeight: 800,
          lineHeight: 1.45,
          textAlign: 'center',
          wordBreak: 'keep-all',
          opacity: Math.max(0, quoteIn),
          transform: `translateY(${(1 - quoteIn) * 50 * u}px)`,
        }}
      >
        {quote}
      </div>
      {author ? (
        <div
          style={{
            marginTop: 52 * u,
            fontSize: 40 * u,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.7)',
            opacity: Math.max(0, authorIn),
            transform: `translateY(${(1 - authorIn) * 30 * u}px)`,
          }}
        >
          — {author}
        </div>
      ) : null}
    </AbsoluteFill>
  )
}
