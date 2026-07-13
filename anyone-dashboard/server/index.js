import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import draftRoutes from './routes/draft.js'
import reviewRoutes from './routes/review.js'
import authRoutes from './routes/auth.js'
import bloggerRoutes from './routes/blogger.js'

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
app.use('/auth', authRoutes)

app.listen(PORT, () => {
  console.log(`[애니원 백엔드] http://localhost:${PORT} 에서 실행 중`)
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY가 설정되지 않았어요. AI 초안 생성/검수가 동작하지 않아요.')
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.warn('⚠️  GOOGLE_CLIENT_ID/SECRET이 설정되지 않았어요. 구글 Blogger 연동이 동작하지 않아요.')
  }
})
