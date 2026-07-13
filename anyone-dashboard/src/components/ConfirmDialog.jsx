import { createContext, useCallback, useContext, useRef, useState } from 'react'

const ConfirmContext = createContext(null)

// 앱 전체에서 window.confirm 대신 이 다이얼로그를 쓰기 위한 Provider
// 사용법: const confirm = useConfirm(); const ok = await confirm('정말 삭제할까요?')
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null) // { message, resolve }
  const resolveRef = useRef(null)

  const confirm = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve
      setState({ message, confirmLabel: options.confirmLabel || '삭제', danger: options.danger !== false })
    })
  }, [])

  const handle = (result) => {
    resolveRef.current?.(result)
    setState(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => handle(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-xl bg-paper-card p-5 shadow-card">
            <p className="mb-4 text-sm text-ink/80">{state.message}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => handle(false)}
                className="rounded-md px-3 py-1.5 text-sm text-ink/60 hover:bg-ink/5"
              >
                취소
              </button>
              <button
                onClick={() => handle(true)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold text-white ${
                  state.danger ? 'bg-stamp-reject hover:bg-stamp-reject/90' : 'bg-stamp-amber hover:bg-stamp-amber/90'
                }`}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm은 ConfirmProvider 내부에서만 사용해야 합니다.')
  return ctx
}
