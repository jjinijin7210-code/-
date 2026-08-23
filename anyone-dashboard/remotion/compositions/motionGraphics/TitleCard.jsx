import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { FONT_STACK, readableTextColor, scaleUnit } from './shared.js'

// 인트로/아웃트로 타이틀 카드.
// props: { title, subtitle, variant: 'intro' | 'outro' } + 공통 { brandColor }
export function TitleCard({ title = '채널 이름', subtitle = '', variant = 'intro', brandColor = '#22c55e' }) {
  const frame = useCurrentFrame()
  const { fps, width, height, durationInFrames } = useVideoConfig()
  const u = scaleUnit(width, height)
  const textColor = readableTextColor(brandColor)

  const titleIn = spring({ frame, fps, config: { damping: 13, stiffness: 110 } })
  const subtitleIn = spring({ frame: frame - Math.round(fps * 0.4), fps, config: { damping: 15 } })
  // 아웃트로는 끝에서 서서히 어두워지며 마무리되는 느낌을 줌
  const fadeOut =
    variant === 'outro'
      ? interpolate(frame, [durationInFrames - fps, durationInFrames], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1

  // 타이틀 아래를 지나가는 포인트 라인
  const lineProgress = interpolate(frame, [fps * 0.3, fps * 1.1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (t) => 1 - Math.pow(1 - t, 3),
  })

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, ${brandColor} 0%, #10101c 130%)`,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT_STACK,
        color: textColor,
        opacity: fadeOut,
        padding: 80 * u,
      }}
    >
      <div
        style={{
          fontSize: 96 * u,
          fontWeight: 900,
          letterSpacing: -2 * u,
          textAlign: 'center',
          wordBreak: 'keep-all',
          opacity: Math.max(0, titleIn),
          transform: `scale(${0.8 + titleIn * 0.2})`,
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 36 * u,
          width: lineProgress * 320 * u,
          height: 10 * u,
          borderRadius: 999,
          background: textColor,
          opacity: 0.85,
        }}
      />
      {subtitle ? (
        <div
          style={{
            marginTop: 40 * u,
            fontSize: 46 * u,
            fontWeight: 600,
            textAlign: 'center',
            wordBreak: 'keep-all',
            opacity: Math.max(0, subtitleIn) * 0.9,
            transform: `translateY(${(1 - subtitleIn) * 30 * u}px)`,
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </AbsoluteFill>
  )
}
