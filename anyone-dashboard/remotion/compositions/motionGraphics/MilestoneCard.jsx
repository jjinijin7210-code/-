import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { FONT_STACK, formatNumber, readableTextColor, scaleUnit } from './shared.js'

// "구독자 25만 명 달성" 같은 축하 카드.
// props: { number, unit, message } + 공통 { brandColor }
export function MilestoneCard({ number = 250000, unit = '명', message = '구독자 달성!', brandColor = '#6d28d9' }) {
  const frame = useCurrentFrame()
  const { fps, width, height, durationInFrames } = useVideoConfig()
  const u = scaleUnit(width, height)
  const textColor = readableTextColor(brandColor)

  // 숫자는 앞쪽 60% 구간 동안 0 → 목표치로 올라가고, 끝날수록 느려지는 easing
  const countProgress = interpolate(frame, [0, durationInFrames * 0.6], [0, 1], {
    extrapolateRight: 'clamp',
    easing: (t) => 1 - Math.pow(1 - t, 3),
  })
  const currentNumber = Number(number) * countProgress

  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 120 } })
  const messageIn = spring({ frame: frame - Math.round(fps * 0.5), fps, config: { damping: 14 } })

  // 축하 파티클 - 숫자 뒤에서 퍼져나가는 원 8개 (에셋 없이 코드로만)
  const particles = Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2
    const burst = spring({ frame: frame - Math.round(fps * 0.3), fps, config: { damping: 20 } })
    const dist = burst * 320 * u
    return {
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      opacity: interpolate(burst, [0, 0.2, 1], [0, 1, 0]),
      size: (12 + (i % 3) * 8) * u,
    }
  })

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${brandColor} 0%, ${brandColor}cc 55%, #10101c 140%)`,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT_STACK,
        color: textColor,
      }}
    >
      {particles.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: textColor,
            opacity: p.opacity * 0.7,
            transform: `translate(${p.x}px, ${p.y}px)`,
          }}
        />
      ))}
      <div style={{ transform: `scale(${pop})`, textAlign: 'center' }}>
        <div style={{ fontSize: 150 * u, fontWeight: 900, letterSpacing: -4 * u, lineHeight: 1 }}>
          {formatNumber(currentNumber)}
          <span style={{ fontSize: 80 * u, fontWeight: 700, marginLeft: 12 * u }}>{unit}</span>
        </div>
      </div>
      <div
        style={{
          marginTop: 48 * u,
          fontSize: 54 * u,
          fontWeight: 700,
          opacity: Math.max(0, messageIn),
          transform: `translateY(${(1 - messageIn) * 40 * u}px)`,
          textAlign: 'center',
          padding: `0 ${60 * u}px`,
        }}
      >
        {message}
      </div>
    </AbsoluteFill>
  )
}
