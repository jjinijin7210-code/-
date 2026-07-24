// 회전 전환(concatWithRotateTransition) + 단일 씬 회전 모션(motion:'rotate') 동작 확인용 임시 테스트.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { renderVideo } from '../server/lib/videoRenderer.js'

if (!process.env.FFMPEG_PATH) {
  const envFile = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  const match = envFile.match(/^FFMPEG_PATH=(.*)$/m)
  if (match) process.env.FFMPEG_PATH = match[1].trim()
  const matchProbe = envFile.match(/^FFPROBE_PATH=(.*)$/m)
  if (matchProbe) process.env.FFPROBE_PATH = matchProbe[1].trim()
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotate-test-'))
const img1 = path.join(tmpDir, 'a.png')
const img2 = path.join(tmpDir, 'b.png')
const outPath = path.join(tmpDir, 'out.mp4')

function makeTestImage(file, color) {
  const r = spawnSync(process.env.FFMPEG_PATH, [
    '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=540x960`,
    '-frames:v', '1', file,
  ], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`${file} 생성 실패`)
}

makeTestImage(img1, 'blue')
makeTestImage(img2, 'green')

renderVideo({
  width: 540,
  height: 960,
  fps: 24,
  transitionDuration: 0.5,
  transitionType: 'rotate',
  scenes: [
    { src: img1, duration: 2, motion: 'zoom-in' },
    { src: img2, duration: 2, motion: 'rotate' },
  ],
}, outPath)

console.log('OK, output:', outPath, fs.existsSync(outPath) ? `(${fs.statSync(outPath).size} bytes)` : '(MISSING)')
