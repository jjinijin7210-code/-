import { AbsoluteFill, Img, Audio, staticFile, useCurrentFrame, useVideoConfig, interpolate } from 'remotion'
import { CaptionOverlay } from './CaptionOverlay.jsx'

// server/lib/videoRenderer.js의 kenBurnsFilter()가 만드는 8가지 효과 중, 이번 phase에서
// 이식하는 6가지(줌인/줌아웃/좌우팬/부메랑/팬부메랑/없음). rotate는 각도+줌 동기화가 복잡해서
// 다음 phase로 미룸 (계획 문서 참고).
const ZOOM_MAX = 1.3
const PAN_SCALE = 1.3
// CSS 개별 transform 속성(scale/translate)을 같이 쓸 때 translate가 scale과 겹쳐 적용돼서
// 실제 화면 이동량이 지정한 px보다 커지는 걸 실측으로 확인함(팬 효과에서 가장자리에 검은
// 틈이 보였음) - 이론적 최대 오버스캔의 60%만 써서 여유를 둠(안전 마진).
const PAN_SAFETY_FACTOR = 0.6
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }

function motionStyle(motion, frame, durationInFrames, width) {
  const half = durationInFrames / 2
  // 팬 효과는 화면보다 30% 큰 이미지를 깔고 좌우로 밀어서, 빈 가장자리가 안 보이게 함
  // (ffmpeg판의 bw = w*1.2 오버스캔과 같은 의도, 여기는 위 안전 마진 때문에 더 크게 잡음)
  const panRange = ((width * (PAN_SCALE - 1)) / 2) * PAN_SAFETY_FACTOR

  // 중요: scale 값은 반드시 문자열로 반환해야 함. React가 style 객체의 숫자 값에는 자동으로
  // "px"를 붙이는데(translate처럼 원래 px 단위인 속성엔 필요하지만), scale은 원래 단위가
  // 없는 값이라 "1.3px" 같은 무효한 값이 돼서 브라우저가 통째로 무시해버림 - 그래서 zoom-in/
  // zoom-out/boomerang이 화면상 전혀 안 움직이는 것처럼 보였던 실제 원인(2026-07-26 실측 확인,
  // React 18 unitless 속성 목록에 scale이 없음). translate는 이미 직접 "...px"로 문자열을
  // 만들어서 보내고 있었어서 우연히 이 문제를 안 겪었음.
  const scale = (n) => String(n)

  switch (motion) {
    case 'zoom-in':
      return { scale: scale(interpolate(frame, [0, durationInFrames], [1.0, ZOOM_MAX], CLAMP)) }
    case 'zoom-out':
      return { scale: scale(interpolate(frame, [0, durationInFrames], [ZOOM_MAX, 1.0], CLAMP)) }
    case 'pan-left':
      return {
        scale: scale(PAN_SCALE),
        translate: `${interpolate(frame, [0, durationInFrames], [panRange, -panRange], CLAMP)}px 0px`,
      }
    case 'pan-right':
      return {
        scale: scale(PAN_SCALE),
        translate: `${interpolate(frame, [0, durationInFrames], [-panRange, panRange], CLAMP)}px 0px`,
      }
    case 'boomerang':
      return { scale: scale(interpolate(frame, [0, half, durationInFrames], [1.0, ZOOM_MAX, 1.0], CLAMP)) }
    case 'pan-boomerang':
      return {
        scale: scale(PAN_SCALE),
        translate: `${interpolate(frame, [0, half, durationInFrames], [panRange, -panRange, panRange], CLAMP)}px 0px`,
      }
    case 'none':
    default:
      return { scale: scale(1) }
  }
}

// fileName이 없으면(Studio 기본값 미리보기용) 실제 사진 대신 색 배경만 보여줌 -
// 실제 렌더링에서는 항상 scene마다 이미지가 있어야 하므로(기존 앱의 canRender 검증과 동일) 발생 안 함.
export function Scene({ fileName, motion, durationInFrames, text, voice, captions }) {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const style = motionStyle(motion, frame, durationInFrames, width)

  return (
    <AbsoluteFill style={{ backgroundColor: 'black', overflow: 'hidden' }}>
      {fileName ? (
        <Img src={staticFile(fileName)} style={{ width: '100%', height: '100%', objectFit: 'cover', ...style }} />
      ) : (
        <AbsoluteFill style={{ backgroundColor: '#2a2a40', ...style }} />
      )}
      <CaptionOverlay captions={captions} text={text} height={height} />
      {voice?.fileName ? <Audio src={staticFile(voice.fileName)} volume={voice.volume ?? 1} /> : null}
    </AbsoluteFill>
  )
}
