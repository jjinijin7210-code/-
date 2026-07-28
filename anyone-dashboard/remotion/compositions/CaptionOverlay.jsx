import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion'
import { createTikTokStyleCaptions } from '@remotion/captions'

// 자동 자막(단어 싱크) 페이지 전환 주기 - 짧을수록 한 번에 뜨는 단어 수가 적어짐(더 잘게 쪼개짐).
// 1200ms로 하면 화면 밖으로 삐져나갈 만큼 여러 단어가 한 번에 뭉쳐서 600ms로 줄임(실측으로 확인).
const SWITCH_CAPTIONS_EVERY_MS = 600
const HIGHLIGHT_COLOR = '#f5a524' // 브랜드 컬러(stamp-amber) 계열

const boxStyle = (height, position) => ({
  backgroundColor: 'rgba(0,0,0,0.45)',
  color: 'white',
  fontSize: height * (position === 'top' ? 0.032 : 0.045),
  fontFamily: '"Malgun Gothic", "Noto Sans CJK KR", sans-serif',
  padding: '0.3em 0.6em',
  borderRadius: 8,
  textAlign: 'center',
  maxWidth: '85%',
  // 'pre'는 단어 사이 공백은 지켜주지만 줄바꿈을 막아서 화면 밖으로 넘칠 수 있음 -
  // 'pre-wrap'은 공백은 그대로 지키면서 길면 다음 줄로 넘어가게 해줌 (실측으로 확인한 수정)
  whiteSpace: 'pre-wrap',
})

// position: 'bottom'(씬별 내레이션 자막, 기본) | 'top'(배경음악 가사 자막) - 내레이션 자막과
// 동시에 떠도 겹치지 않게 위아래로 자리를 나눔.
const containerStyle = (height, position) =>
  position === 'top'
    ? { justifyContent: 'flex-start', alignItems: 'center', paddingTop: height * 0.06, paddingLeft: 24, paddingRight: 24 }
    : { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: height * 0.12, paddingLeft: 24, paddingRight: 24 }

function CaptionPage({ page, height, position }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const absoluteTimeMs = page.startMs + (frame / fps) * 1000

  return (
    <AbsoluteFill style={containerStyle(height, position)}>
      <span style={boxStyle(height, position)}>
        {page.tokens.map((token) => {
          const isActive = token.fromMs <= absoluteTimeMs && token.toMs > absoluteTimeMs
          return (
            <span key={token.fromMs} style={{ color: isActive ? HIGHLIGHT_COLOR : 'white' }}>
              {token.text}
            </span>
          )
        })}
      </span>
    </AbsoluteFill>
  )
}

// captions(자동 인식 결과, Caption[])가 있으면 단어 단위로 하이라이트되는 자막을,
// 없으면 기존처럼 고정 자막(text)을 보여줌. position='top'은 배경음악 가사용(씬 내레이션
// 자막과 동시에 떠도 안 겹치게 화면 위쪽에 표시).
export function CaptionOverlay({ captions, text, height, position = 'bottom' }) {
  const { fps } = useVideoConfig()

  if (captions && captions.length) {
    const { pages } = createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: SWITCH_CAPTIONS_EVERY_MS })
    return (
      <AbsoluteFill>
        {pages.map((page, index) => {
          // page.durationMs는 이 페이지에 묶인 단어들이 실제로 말해지는 길이 - combineTokensWithinMilliseconds는
          // "단어 사이 간격이 이보다 좁으면 한 페이지로 묶는다"는 기준일 뿐, 페이지 자체 길이를 그 값으로
          // 고정하면 실제 발화보다 짧게 끊겨서 자막 없는 빈 구간이 생김(실측으로 확인한 버그) - 그래서
          // 고정값 대신 각 페이지의 실제 durationMs를 그대로 씀.
          const startFrame = Math.round((page.startMs / 1000) * fps)
          const durationInFrames = Math.round((page.durationMs / 1000) * fps)
          if (durationInFrames <= 0) return null
          return (
            <Sequence key={index} from={startFrame} durationInFrames={durationInFrames}>
              <CaptionPage page={page} height={height} position={position} />
            </Sequence>
          )
        })}
      </AbsoluteFill>
    )
  }

  if (!text) return null

  return (
    <AbsoluteFill style={containerStyle(height, position)}>
      <span style={boxStyle(height, position)}>{text}</span>
    </AbsoluteFill>
  )
}
