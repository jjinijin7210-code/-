export function LoadingView() {
  return <p className="py-10 text-center text-sm text-ink/40">불러오는 중...</p>
}

export function ErrorView({ message }) {
  return (
    <div className="rounded-lg border border-stamp-reject/30 bg-stamp-reject/5 p-4 text-sm text-stamp-reject">
      데이터를 불러오지 못했어요: {message}
    </div>
  )
}

export function EmptyView({ label = '아직 등록된 항목이 없어요.' }) {
  return (
    <div className="rounded-lg border border-dashed border-ink/15 py-10 text-center text-sm text-ink/40">
      {label}
    </div>
  )
}
