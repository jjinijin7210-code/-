import dotenv from 'dotenv'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import draftRoutes from './routes/draft.js'
import reviewRoutes from './routes/review.js'
import authRoutes from './routes/auth.js'
import bloggerRoutes from './routes/blogger.js'
import youtubeRoutes from './routes/youtube.js'
import sourcingRoutes from './routes/sourcing.js'
import shortsRoutes, { GENERATED_DIR } from './routes/shorts.js'
import imagesRoutes from './routes/images.js'
import pexelsRoutes from './routes/pexels.js'

// 별도로 server/.env를 만들지 않고, 프로젝트 루트의 .env 파일 하나만 읽어요.
// (이미 프론트엔드용 .env에 ANTHROPIC_API_KEY 등을 추가해두셨다면 그대로 인식됩니다.)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json({ limit: '5mb' })) // 이미지 base64가 섞인 요청도 받을 수 있게 넉넉하게

app.get('/health', (req, res) => res.json({ ok: true }))

app.use('/api', draftRoutes)
app.use('/api', reviewRoutes)
app.use('/api', bloggerRoutes)
app.use('/api', youtubeRoutes)
app.use('/api', sourcingRoutes)
app.use('/api', shortsRoutes)
app.use('/api', imagesRoutes)
app.use('/api', pexelsRoutes)
app.use('/auth', authRoutes)

// 쇼츠 렌더링 결과(mp4)를 바로 재생/다운로드할 수 있게 정적으로 서빙
fs.mkdirSync(GENERATED_DIR, { recursive: true })
app.use('/generated', express.static(GENERATED_DIR))

// 배포(프로덕션) 환경에서는 프론트엔드(vite build 결과)까지 이 서버 하나가 같이 서빙한다.
// 로컬 개발(npm run dev:all)에서는 vite dev 서버가 따로 5173번에서 떠서 이 블록은 그냥 건너뛴다.
const distPath = path.join(__dirname, '..', 'dist')
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get(/^(?!\/api|\/auth).*/, (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`[애니원 백엔드] http://localhost:${PORT} 에서 실행 중`)
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY가 설정되지 않았어요. AI 초안 생성/검수가 동작하지 않아요.')
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.warn('⚠️  GOOGLE_CLIENT_ID/SECRET이 설정되지 않았어요. 구글 Blogger 연동이 동작하지 않아요.')
  }
  if (!process.env.YOUTUBE_API_KEY) {
    console.warn('⚠️  YOUTUBE_API_KEY가 설정되지 않았어요. 벤치마킹 리포트의 유튜브 검색이 동작하지 않아요.')
  }
  if (!process.env.APIFY_TOKEN) {
    console.warn('⚠️  APIFY_TOKEN이 설정되지 않았어요. 벤치마킹 리포트의 1688 상품 소싱 검색이 동작하지 않아요.')
  }
  if (!process.env.ELEVENLABS_API_KEY) {
    console.warn('⚠️  ELEVENLABS_API_KEY가 설정되지 않았어요. 쇼츠 자동 제작(내레이션 음성)이 동작하지 않아요.')
  }
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️  OPENAI_API_KEY가 설정되지 않았어요. AI 이미지 생성이 동작하지 않아요.')
  }
  if (!process.env.PEXELS_API_KEY) {
    console.warn('⚠️  PEXELS_API_KEY가 설정되지 않았어요. 무료 스톡 사진 검색이 동작하지 않아요.')
  }
})
