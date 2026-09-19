import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { FONT_STACK, formatNumber, scaleUnit } from './shared.js'

// 숫자가 시작값에서 목표치까지 올라가는 통계 카운트업.
// props: { startValue, endValue, label, suffix } + 공통 { brandColor }
export function StatCountup({ startValue = 0, endValue = 1000, label = '월 방문자 수', suffix = '', brandColor = '#0ea5e9' }) {
  const frame = useCurrentFrame()
  const { fps, width, height, durationInFrames } = useVideoConfig()
  const u = scaleUnit(width, height)

  const progress = interpolate(frame, [fps * 0.3, durationInFrames * 0.75], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (t) => 1 - Math.pow(1 - t, 4),
  })
  const currentValue = Number(startValue) + (Number(endValue) - Number(startValue)) * progress

  const labelIn = spring({ frame, fps, config: { damping: 14 } })

  return (
    <AbsoluteFill
      style={{
        background: '#10101c',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT_STACK,
        color: '#ffffff',
      }}
    >
      <div
        style={{
          fontSize: 46 * u,
          fontWeight: 600,
          color: brandColor,
          opacity: labelIn,
          transform: `translateY(${(1 - labelIn) * -30 * u}px)`,
          marginBottom: 36 * u,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 160 * u, fontWeight: 900, letterSpacing: -5 * u, lineHeight: 1 }}>
        {formatNumber(currentValue)}
        {suffix ? <span style={{ fontSize: 76 * u, fontWeight: 700, marginLeft: 10 * u }}>{suffix}</span> : null}
      </div>
      {/* 진행 게이지 - 숫자와 같은 progress를 공유해서 카운트업과 정확히 동기화됨 */}
      <div
        style={{
          marginTop: 64 * u,
          width: Math.min(width * 0.6, 640 * u),
          height: 14 * u,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.15)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: '100%',
            borderRadius: 999,
            background: `linear-gradient(90deg, ${brandColor}, #ffffff)`,
          }}
        />
      </div>
    </AbsoluteFill>
  )
}
