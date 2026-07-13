const CONFIG = {
  idle: null,
  saving: { text: '저장 중...', className: 'text-ink/40' },
  saved: { text: '✓ 저장됨', className: 'text-stamp-pass' },
  error: { text: '✕ 저장 실패', className: 'text-stamp-reject' },
}

export default function SaveStatusIndicator({ status }) {
  const cfg = CONFIG[status]
  if (!cfg) return <span className="text-xs">&nbsp;</span>
  return <span className={`text-xs font-medium ${cfg.className}`}>{cfg.text}</span>
}
