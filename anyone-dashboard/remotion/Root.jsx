import { Composition } from 'remotion'
import { VideoStudioComposition } from './compositions/VideoStudioComposition.jsx'
import { computeTotalDuration } from './lib/timing.js'

// Studio 미리보기용 기본값 - fileName을 비워두면 Scene.jsx가 실제 사진 대신 색 배경을 보여줌
// (실제 렌더링에서는 server/lib/remotionRenderer.js가 매번 진짜 씬 데이터를 inputProps로 넘김).
const defaultProps = {
  width: 1080,
  height: 1920,
  fps: 30,
  transitionFrames: 18,
  bgm: null,
  scenes: [
    { fileName: null, motion: 'zoom-in', durationInFrames: 90, text: '샘플 자막 - 한글 확인용', voice: null },
    { fileName: null, motion: 'pan-left', durationInFrames: 90, text: '', voice: null },
    { fileName: null, motion: 'boomerang', durationInFrames: 90, text: '부메랑 효과', voice: null },
  ],
}

function calculateMetadata({ props }) {
  const { fps, width, height, scenes, transitionFrames } = props
  return {
    fps,
    width,
    height,
    durationInFrames: computeTotalDuration(scenes, transitionFrames),
  }
}

export function RemotionRoot() {
  return (
    <Composition
      id="VideoStudioScene"
      component={VideoStudioComposition}
      durationInFrames={computeTotalDuration(defaultProps.scenes, defaultProps.transitionFrames)}
      fps={defaultProps.fps}
      width={defaultProps.width}
      height={defaultProps.height}
      defaultProps={defaultProps}
      calculateMetadata={calculateMetadata}
    />
  )
}
