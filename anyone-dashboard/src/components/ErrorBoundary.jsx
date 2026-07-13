import { Component } from 'react'
import { getErrorFallbackState, INITIAL_ERROR_STATE } from '../lib/errorBoundaryLogic'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = INITIAL_ERROR_STATE
  }

  static getDerivedStateFromError(error) {
    return getErrorFallbackState(error)
  }

  componentDidCatch(error, info) {
    // 콘솔에는 남겨서 디버깅할 수 있게 하되, 화면은 하얗게 꺼지지 않고 안내 화면으로 대체
    console.error('[애니원] 처리되지 않은 오류:', error, info)
  }

  handleReset = () => {
    this.setState(INITIAL_ERROR_STATE)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-paper p-6 text-center">
          <p className="text-4xl">⚠️</p>
          <h1 className="text-lg font-bold text-ink">예상하지 못한 오류가 발생했어요</h1>
          <p className="max-w-md text-sm text-ink/60">{this.state.message}</p>
          <p className="max-w-md text-xs text-ink/40">
            데이터는 그대로 저장되어 있을 가능성이 높아요. 아래 버튼으로 다시 시도하거나, 새로고침 해보세요.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={this.handleReset}
              className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90"
            >
              다시 시도
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-md border border-ink/15 px-4 py-2 text-sm font-semibold text-ink hover:bg-ink/5"
            >
              새로고침
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
