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
    },
  },
})
