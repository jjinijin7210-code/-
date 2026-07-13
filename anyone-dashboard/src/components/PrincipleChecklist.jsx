// 계획서에서 지정한 "꼭 지켜야 할 원칙" 두 가지를 화면 어디서든 빠지지 않고 노출
// (사이드바 하단에 항상 고정 - 어떤 탭으로 이동해도 사라지지 않음)
const PRINCIPLES = [
  '실존 인물(가족 등) 사진 기반 이미지 생성 절대 금지',
  '해외 원본 영상·이미지 가공 재사용 금지 (아이디어만 참고, 소재는 새로 제작)',
]

export default function PrincipleChecklist({ compact = false }) {
  return (
    <div
      className={`rounded-lg border border-stamp-reject/30 bg-stamp-reject/5 p-3 ${
        compact ? 'text-[11px]' : 'text-xs'
      }`}
    >
      <p className="mb-1.5 font-bold text-stamp-reject">⚠️ 안전 원칙 (항상 확인)</p>
      <ul className="space-y-1">
        {PRINCIPLES.map((p) => (
          <li key={p} className="flex gap-1.5 text-ink/80">
            <span className="text-stamp-reject">·</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
