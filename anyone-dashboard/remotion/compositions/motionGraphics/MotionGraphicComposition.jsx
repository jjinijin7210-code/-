import { AbsoluteFill } from 'remotion'
import { MilestoneCard } from './MilestoneCard.jsx'
import { StatCountup } from './StatCountup.jsx'
import { ComparisonCard } from './ComparisonCard.jsx'
import { QuoteCard } from './QuoteCard.jsx'
import { TitleCard } from './TitleCard.jsx'

// 모션그래픽 만들기 탭의 단일 진입 컴포지션 - template 값으로 5종 중 하나를 고른다.
// (템플릿마다 Composition을 따로 등록하지 않고 하나로 두면, 서버 렌더러가 컴포지션 id 하나만
// 알면 되고 크기/길이는 calculateMetadata로 inputProps에서 그대로 받는다.)
export const MOTION_TEMPLATES = {
  milestone: MilestoneCard,
  countup: StatCountup,
  comparison: ComparisonCard,
  quote: QuoteCard,
  title: TitleCard,
}

export function MotionGraphicComposition({ template = 'milestone', props = {} }) {
  const Template = MOTION_TEMPLATES[template] || MilestoneCard
  return (
    <AbsoluteFill style={{ background: '#10101c' }}>
      <Template {...props} />
    </AbsoluteFill>
  )
}
