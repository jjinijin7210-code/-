// 배경 합성 렌더링 로직(scene.background) 동작 확인용 임시 테스트.
// 실제 코코로 투명 PNG가 아직 없어서, 합성 자체가 되는지만 확인하는 용도.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { renderVideo, generateSolidBackground } from '../server/lib/videoRenderer.js'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-composite-test-'))
const charPath = path.join(tmpDir, 'char.png')
const bgPath = path.join(tmpDir, 'bg.png')
const outPath = path.join(tmpDir, 'out.mp4')

// 투명 배경 + 빨간 네모(테스트용 가짜 캐릭터)
const r1 = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', [
  '-y', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=400x600',
  '-vf', 'drawbox=x=100:y=200:w=200:h=200:color=red@1.0:t=fill',
  '-update', '1', '-frames:v', '1', charPath,
], { stdio: 'inherit' })
if (r1.status !== 0) throw new Error('char.png 생성 실패')

generateSolidBackground('#EAF7F1', 540, 960, bgPath)

renderVideo({
  width: 540,
  height: 960,
  fps: 24,
  scenes: [{ src: charPath, background: bgPath, duration: 2, motion: 'none', text: '테스트' }],
}, outPath)

console.log('OK, output:', outPath, fs.existsSync(outPath) ? `(${fs.statSync(outPath).size} bytes)` : '(MISSING)')
