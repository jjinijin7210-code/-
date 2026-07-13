/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // 애니원 관제실 팔레트
        // ink: 사이드바/헤더용 짙은 남색 (명패, 조직도 느낌)
        ink: {
          DEFAULT: '#16203A',
          light: '#3C4568',
          soft: '#232C4A',
        },
        // paper: 메인 화면 배경 (종이/서류 느낌)
        paper: {
          DEFAULT: '#F6F5F1',
          card: '#FFFFFF',
        },
        // 결재 도장 색상 (통과/반려/대기)
        stamp: {
          pass: '#3F8F6F',
          reject: '#B7503F',
          pending: '#8B8F99',
          amber: '#B8823C', // 포인트 컬러 (강조/액션)
        },
      },
      fontFamily: {
        sans: ['Pretendard', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(22, 32, 58, 0.06), 0 1px 3px rgba(22, 32, 58, 0.08)',
      },
    },
  },
  plugins: [],
}
