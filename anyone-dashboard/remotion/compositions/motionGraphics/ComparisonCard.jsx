import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { FONT_STACK, formatNumber, scaleUnit } from './shared.js'

// 두 항목을 나란히 비교하는 카드 - 좌우 패널이 슬라이드 인 되고 막대가 값 비율만큼 자람.
// props: { title, itemAName, itemAValue, itemBName, itemBValue, valueSuffix } + 공통 { brandColor }
export function ComparisonCard({
  title = 'A vs B',
  itemAName = '항목 A',
  itemAValue = 100,
  itemBName = '항목 B',
  itemBValue = 200,
  valueSuffix = '',
  brandColor = '#f59e0b',
}) {
  const frame = useCurrentFrame()
  const { fps, width, height, durationInFrames } = useVideoConfig()
  const u = scaleUnit(width, height)

  const maxValue = Math.max(Number(itemAValue), Number(itemBValue), 1)
  const titleIn = spring({ frame, fps, config: { damping: 14 } })
  const slideA = spring({ frame: frame - Math.round(fps * 0.25), fps, config: { damping: 15 } })
  const slideB = spring({ frame: frame - Math.round(fps * 0.45), fps, config: { damping: 15 } })
  const barProgress = interpolate(frame, [fps * 0.8, durationInFrames * 0.8], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (t) => 1 - Math.pow(1 - t, 3),
  })

  // 세로 화면에서는 패널을 위아래로, 가로/정사각에선 좌우로 배치
  const isPortrait = height > width

  const renderItem = (name, value, slide, color, fromLeft) => {
    const ratio = Number(value) / maxValue
    return (
      <div
        style={{
          flex: 1,
          background: 'rgba(255,255,255,0.06)',
          borderRadius: 28 * u,
          padding: 44 * u,
          opacity: Math.max(0, slide),
          transform: `translate${isPortrait ? 'Y' : 'X'}(${(1 - slide) * (fromLeft ? -80 : 80) * u}px)`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 24 * u,
        }}
      >
        <div style={{ fontSize: 44 * u, fontWeight: 700 }}>{name}</div>
        <div style={{ fontSize: 84 * u, fontWeight: 900, color }}>
          {formatNumber(Number(value) * barProgress)}
          {valueSuffix}
        </div>
        <div style={{ height: 18 * u, borderRadius: 999, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
          <div style={{ width: `${ratio * barProgress * 100}%`, height: '100%', borderRadius: 999, background: color }} />
        </div>
      </div>
    )
  }

  return (
    <AbsoluteFill
      style={{
        background: '#10101c',
        fontFamily: FONT_STACK,
        color: '#ffffff',
        padding: 72 * u,
        justifyContent: 'center',
        gap: 40 * u,
      }}
    >
      <div
        style={{
          fontSize: 58 * u,
          fontWeight: 800,
          textAlign: 'center',
          opacity: titleIn,
          transform: `translateY(${(1 - titleIn) * -30 * u}px)`,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: isPortrait ? 'column' : 'row', gap: 36 * u, flex: isPortrait ? 'none' : '0 1 auto' }}>
        {renderItem(itemAName, itemAValue, slideA, brandColor, true)}
        {renderItem(itemBName, itemBValue, slideB, '#38bdf8', false)}
      </div>
    </AbsoluteFill>
  )
}
