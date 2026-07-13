// Error Boundary가 에러를 잡았을 때 화면에 보여줄 상태를 계산하는 순수 함수.
// React의 componentDidCatch/getDerivedStateFromError 안에서는 이 함수만 호출하고,
// 실제 판단 로직은 여기 순수 함수로 분리해서 Node.js에서 테스트할 수 있게 했습니다.

export function getErrorFallbackState(error) {
  return {
    hasError: true,
    message: error?.message || '알 수 없는 오류가 발생했어요.',
  }
}

export const INITIAL_ERROR_STATE = { hasError: false, message: '' }
