import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 애니원(AnyOne) 대시보드 - Vite 설정
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 프론트엔드에서 fetch('/api/...'), fetch('/auth/...') 하면
      // 개발 중엔 자동으로 백엔드 서버(server/index.js, 기본 3001번 포트)로 전달됨
      '/api': 'http://localhost:3001',
      '/auth': 'http://localhost:3001',
      '/bgm-assets': 'http://localhost:3001',
      '/generated': 'http://localhost:3001',
    },
    watch: {
      // 영상 제작실이 렌더링 결과 mp4를 이 프로젝트 폴더 안(generated/)에 새로 써서, Vite의
      // 파일 감시가 그 파일을 아직 쓰는 중에 열어보려다 윈도우에서 EBUSY로 죽는 문제가 있었음
      // (2026-07-26, Remotion 베타 테스트 중 발견) - 감시 대상에서 아예 제외해서 방지.
      ignored: ['**/generated/**'],
    },
  },
})
