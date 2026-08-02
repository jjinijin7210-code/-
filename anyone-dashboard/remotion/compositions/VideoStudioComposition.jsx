import { AbsoluteFill, Audio, staticFile, useVideoConfig } from 'remotion'
import { TransitionSeries, linearTiming } from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { flip } from '@remotion/transitions/flip'
import { Scene } from './Scene.jsx'
import { CaptionOverlay } from './CaptionOverlay.jsx'
import { DecorationOverlay } from './DecorationOverlay.jsx'
import { PolaroidFrame } from './PolaroidFrame.jsx'
import { computeBoundaryTransitions } from '../lib/timing.js'

// 페이드 + 회전(포토카드처럼 젖혀짐) 전환 지원. diagonal은 아직 다음 phase - VideoStudio.jsx에서
// engine=remotion일 때 transitionType이 fade/rotate가 아니면 여기 도달하기 전에 이미 fade로
// 대체돼서 넘어옴 (server/routes/videoStudio.js).
export function VideoStudioComposition({ scenes, transitionFrames, bgm, transitionType, decoration }) {
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

  // 2026-07-30: "하트 효과" = 참고 영상처럼 폴라로이드 프레임 + 하트 장식 세트 - 씬 콘텐츠를
  // 폴라로이드 안에 넣고, 배경음악 자막도 같이 축소되게 프레임 안에 포함시킴(자막이 영상
  // 콘텐츠에 대한 것이라 콘텐츠와 분리되면 어색함). 하트는 프레임 바깥 검은 여백에 배치.
  const sceneContent = (
    <>
      <TransitionSeries>{children}</TransitionSeries>
      {bgm?.captions ? <CaptionOverlay captions={bgm.captions} height={height} position="top" /> : null}
    </>
  )

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {bgm?.fileName ? <Audio src={staticFile(bgm.fileName)} volume={bgm.volume ?? 1} loop /> : null}
      {decoration && decoration !== 'none' ? (
        <>
          <PolaroidFrame>{sceneContent}</PolaroidFrame>
          <DecorationOverlay mode="polaroid" style={decoration} />
        </>
      ) : (
        sceneContent
      )}
    </AbsoluteFill>
  )
}
