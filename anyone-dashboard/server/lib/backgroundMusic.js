// ============================================================
// 내레이션이 있는 자동 생성 영상에 잔잔한 배경음악을 깔기 위한 파일 선택기.
// server/assets/bgm/ 폴더에 저작권 문제 없는(로열티 프리) mp3 파일을 넣어두면
// 그중 하나를 랜덤으로 골라 씀. 파일이 하나도 없으면 null을 돌려주고, 그러면
// 배경음악 없이(예전처럼 내레이션만) 렌더링된다 - 파일 없다고 실패하지 않음.
// ============================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const BGM_DIR = path.join(__dirname, '..', 'assets', 'bgm')

// 2026-07-23: 수노(Suno)로 만든 배경음악을 wav로 받아와서 mp3 확장자도 함께 지원하도록 확장
export function pickBackgroundMusic() {
  if (!fs.existsSync(BGM_DIR)) return null
  const files = fs.readdirSync(BGM_DIR).filter((f) => /\.(mp3|wav)$/i.test(f))
  if (files.length === 0) return null
  const picked = files[Math.floor(Math.random() * files.length)]
  return path.join(BGM_DIR, picked)
}
