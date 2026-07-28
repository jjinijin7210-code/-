import { AbsoluteFill, Audio, staticFile, useVideoConfig } from 'remotion'
import { TransitionSeries, linearTiming } from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { flip } from '@remotion/transitions/flip'
import { Scene } from './Scene.jsx'
import { CaptionOverlay } from './CaptionOverlay.jsx'
import { computeBoundaryTransitions } from '../lib/timing.js'

// 페이드 + 회전(포토카드처럼 젖혀짐) 전환 지원. diagonal은 아직 다음 phase - VideoStudio.jsx에서
// engine=remotion일 때 transitionType이 fade/rotate가 아니면 여기 도달하기 전에 이미 fade로
// 대체돼서 넘어옴 (server/routes/videoStudio.js).
export function VideoStudioComposition({ scenes, transitionFrames, bgm, transitionType }) {
  const { height } = useVideoConfig()
  const boundaryFrames = computeBoundaryTransitions(scenes, transitionFrames)
  const presentation = transitionType === 'rotate' ? flip({ direction: 'from-left' }) : fade()

  const children = []
  scenes.forEach((scene, i) => {
    children.push(
      <TransitionSeries.Sequence key={`scene-${i}`} durationInFrames={scene.durationInFrames}>
        <Scene {...scene} />
      </TransitionSeries.Sequence>
    )
    if (i < scenes.length - 1 && boundaryFrames[i] > 0) {
      children.push(
        <TransitionSeries.Transition
          key={`transition-${i}`}
          presentation={presentation}
          timing={linearTiming({ durationInFrames: boundaryFrames[i] })}
        />
      )
    }
  })

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {bgm?.fileName ? <Audio src={staticFile(bgm.fileName)} volume={bgm.volume ?? 1} loop /> : null}
      <TransitionSeries>{children}</TransitionSeries>
      {/* 배경음악 가사 자막(있으면) - 씬 하나짜리가 아니라 영상 전체를 가로지르는 트랙이라
          씬 컴포넌트 안이 아니라 여기(컴포지션 루트)에 두고, 내레이션 자막(하단)과 안 겹치게
          화면 위쪽에 표시 (CaptionOverlay의 position='top'). */}
      {bgm?.captions ? <CaptionOverlay captions={bgm.captions} height={height} position="top" /> : null}
    </AbsoluteFill>
  )
}
