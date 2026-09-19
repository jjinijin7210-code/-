// ============================================================
// "모션그래픽 만들기" 탭용 렌더러 (설계 문서: 자체 제작, 힉스필드 미사용).
// remotionRenderer.js(영상 제작실 베타)와 같은 Remotion 파이프라인을 쓰지만,
// 씬 사진/음성 같은 외부 에셋이 전혀 없어서(순수 코드 템플릿) 훨씬 단순하다.
// 크레딧 소모 없이 서버 컴퓨팅만 쓰고, 렌더링은 로컬 헤드리스 크롬에서 이뤄진다.
// ============================================================

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENTRY_POINT = path.join(__dirname, '..', '..', 'remotion', 'index.jsx')
const COMPOSITION_ID = 'MotionGraphic'

// 화면 비율 선택지 - 설계 문서의 세로(릴스/쇼츠)/가로(유튜브)/정사각 3종
export const ASPECT_PRESETS = {
  vertical: { width: 1080, height: 1920 },
  horizontal: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
}

export const DURATION_CHOICES = [3, 5, 8]

// UI 썸네일/입력폼 구성과 루나원 연동이 같이 쓰는 템플릿 메타데이터.
// fields는 프론트가 입력폼을 그리는 데 쓰고, 서버 검증에도 같은 목록을 쓴다.
export const MOTION_TEMPLATE_META = [
  {
    id: 'milestone',
    name: '마일스톤 카드',
    description: '"구독자 25만 명 달성" 같은 축하 카드',
    fields: [
      { key: 'number', label: '숫자', type: 'number', required: true, example: 250000 },
      { key: 'unit', label: '단위', type: 'text', required: false, example: '명' },
      { key: 'message', label: '문구', type: 'text', required: true, example: '구독자 달성!' },
    ],
  },
  {
    id: 'countup',
    name: '통계 카운트업',
    description: '숫자가 시작값에서 목표치까지 올라가는 애니메이션',
    fields: [
      { key: 'startValue', label: '시작값', type: 'number', required: true, example: 0 },
      { key: 'endValue', label: '끝값', type: 'number', required: true, example: 10000 },
      { key: 'label', label: '라벨', type: 'text', required: true, example: '월 방문자 수' },
      { key: 'suffix', label: '단위(선택)', type: 'text', required: false, example: '명' },
    ],
  },
  {
    id: 'comparison',
    name: '비교 카드',
    description: '두 항목을 나란히 비교',
    fields: [
      { key: 'title', label: '제목', type: 'text', required: true, example: '작년 vs 올해' },
      { key: 'itemAName', label: '항목A 이름', type: 'text', required: true, example: '작년' },
      { key: 'itemAValue', label: '항목A 값', type: 'number', required: true, example: 120 },
      { key: 'itemBName', label: '항목B 이름', type: 'text', required: true, example: '올해' },
      { key: 'itemBValue', label: '항목B 값', type: 'number', required: true, example: 340 },
      { key: 'valueSuffix', label: '값 단위(선택)', type: 'text', required: false, example: '만원' },
    ],
  },
  {
    id: 'quote',
    name: '인용구 카드',
    description: '짧은 문구 강조',
    fields: [
      { key: 'quote', label: '문구', type: 'text', required: true, example: '기록은 기억을 이긴다' },
      { key: 'author', label: '출처(선택)', type: 'text', required: false, example: '' },
    ],
  },
  {
    id: 'title',
    name: '인트로/아웃트로 타이틀 카드',
    description: '영상 시작/끝에 쓰는 타이틀',
    fields: [
      { key: 'title', label: '타이틀', type: 'text', required: true, example: '채널 이름' },
      { key: 'subtitle', label: '서브타이틀(선택)', type: 'text', required: false, example: '구독과 좋아요는 큰 힘이 됩니다' },
      { key: 'variant', label: '용도', type: 'select', options: ['intro', 'outro'], required: false, example: 'intro' },
    ],
  },
]

// bundle()은 몇 초씩 걸려서 렌더 요청마다 다시 하지 않고 첫 렌더 때 한 번만 만들어 재사용.
// (모션그래픽은 외부 에셋이 없어 publicDir이 매번 달라질 일도 없음 - remotionRenderer.js와
// 다르게 캐싱해도 안전한 이유)
let bundlePromise = null
function getBundle() {
  if (!bundlePromise) {
    bundlePromise = bundle({ entryPoint: ENTRY_POINT }).catch((err) => {
      bundlePromise = null // 실패한 번들을 캐시에 남기면 서버 재시작 전까지 계속 실패함
      throw err
    })
  }
  return bundlePromise
}

export async function renderMotionGraphic({ template, props, aspect = 'vertical', durationSec = 5, brandColor }, outputPath) {
  const size = ASPECT_PRESETS[aspect] || ASPECT_PRESETS.vertical
  const fps = 30
  const inputProps = {
    width: size.width,
    height: size.height,
    fps,
    durationInFrames: Math.max(1, Math.round(Number(durationSec) * fps)),
    template,
    props: { ...props, ...(brandColor ? { brandColor } : {}) },
  }

  const bundleLocation = await getBundle()
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: COMPOSITION_ID,
    inputProps,
  })

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps,
  })
}
