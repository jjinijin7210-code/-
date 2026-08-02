import { useVideoConfig } from 'remotion'

// 2026-07-30: 참고 영상(코코로 아이스바나나우유)처럼 영상 콘텐츠 자체를 검은 배경 위 살짝
// 기울어진 폴라로이드 사진으로 보이게 감싸는 프레임. 안쪽 씬(TransitionSeries)은 원래 크기
// 그대로 렌더링한 뒤 CSS transform: scale()로만 축소해서 넣기 때문에, Scene.jsx/
// CaptionOverlay.jsx 안의 useVideoConfig() 기반 위치·크기 계산은 전혀 안 건드림(둘 다 여전히
// 실제 컴포지션 크기를 기준으로 계산되고, 시각적으로만 통째로 축소·회전됨).
export function PolaroidFrame({ children }) {
  const { width, height } = useVideoConfig()

  const framePad = width * 0.035
  const captionStrip = height * 0.05 // 실제 폴라로이드 하단 여백 느낌
  const frameWidth = width * 0.72
  const photoWidth = frameWidth - framePad * 2
  const photoHeight = photoWidth * (height / width)
  const frameHeight = photoHeight + framePad * 2 + captionStrip
  const contentScale = photoWidth / width

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: frameWidth,
        height: frameHeight,
        background: '#fff',
        padding: framePad,
        paddingBottom: framePad + captionStrip,
        boxShadow: '0 30px 90px rgba(0,0,0,0.7)',
        transform: 'translate(-50%, -50%) rotate(-5deg)',
      }}
    >
      <div style={{ width: photoWidth, height: photoHeight, overflow: 'hidden', position: 'relative' }}>
        <div style={{ width, height, transform: `scale(${contentScale})`, transformOrigin: 'top left' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
