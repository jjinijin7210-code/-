// 씬 사이 페이드 전환 길이를 계산 - ffmpeg판(server/lib/videoRenderer.js의 concatWithCrossfade)이
// 전환 길이를 양쪽 인접 씬 길이보다 길게 잡지 못하게 clamp하던 것과 같은 의도.
// (-1은 전환이 씬 전체를 다 잡아먹어서 화면에 아무것도 안 남는 극단적인 경우를 막기 위한 여유)
export function computeBoundaryTransitions(scenes, transitionFrames) {
  const boundaries = []
  for (let i = 0; i < scenes.length - 1; i++) {
    const maxAllowed = Math.min(scenes[i].durationInFrames, scenes[i + 1].durationInFrames) - 1
    boundaries.push(Math.max(0, Math.min(transitionFrames, maxAllowed)))
  }
  return boundaries
}

// TransitionSeries는 전환 구간만큼 앞뒤 씬이 겹치므로, 전체 길이는 씬 길이 합에서 겹치는 만큼을 뺀 값.
export function computeTotalDuration(scenes, transitionFrames) {
  const total = scenes.reduce((sum, s) => sum + s.durationInFrames, 0)
  const overlapSum = computeBoundaryTransitions(scenes, transitionFrames).reduce((a, b) => a + b, 0)
  return Math.max(1, total - overlapSum)
}
