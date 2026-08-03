// ============================================================
// 영상 우측 하단에 고정된 워터마크(예: NotebookLM 로고)를 ffmpeg delogo 필터로 지운다.
// anyone-dashboard/server/lib/watermarkRemover.js에서 그대로 포팅함 (2026-08-01,
// "노트북LM 워터마크 지우기 나도 할 수 있게 해줘" 요청 - 애니원/루나원 둘 다에 필요).
//
// 진희님 실제 영상(수익과_패닉의_역설.mp4, 1280x720)에서 워터마크 위치를 직접 확인해서
// 좌표를 잡았고, 그 좌표를 1280x720 기준 비율로 저장해뒀다가 실제 업로드된 영상 크기에
// 맞게 다시 계산함(노트북LM 내보내기가 항상 1280x720은 아닐 수도 있어서 - best-effort로
// 비율 스케일링).
//
// delogo는 "그 위치엔 로고 같은 단순한 게 있었다"고 가정하고 주변 픽셀로 자연스럽게
// 채우는 필터라, 배경이 복잡하지 않은 노트북LM 특유의 손그림풍 배경에서 잘 먹힘(실측
// 확인 - 흰 배경은 완벽히 지워지고, 민트색 배경은 아주 옅은 흔적만 남음).
// ============================================================

import { spawn } from 'node:child_process'

function ffmpegBin() {
  return process.env.FFMPEG_PATH || 'ffmpeg'
}
function ffprobeBin() {
  return process.env.FFPROBE_PATH || 'ffprobe'
}

// 1280x720 기준 진희님 실제 노트북LM 영상에서 확인한 워터마크 위치를 비율로 저장
const NOTEBOOKLM_WATERMARK_RATIO = { x: 1115 / 1280, y: 650 / 720, w: 140 / 1280, h: 35 / 720 }

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    const stdout = []
    let stderr = ''
    child.stdout?.on('data', (chunk) => stdout.push(chunk))
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000)
    })
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, stdout: Buffer.concat(stdout), stderr }))
  })
}

async function probeSize(filePath) {
  let res
  try {
    res = await run(ffprobeBin(), [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0', filePath,
    ])
  } catch (error) {
    throw new Error(`ffprobe를 실행하지 못했어요 (${error.message}).`)
  }
  if (res.code !== 0) {
    throw new Error('영상 크기를 확인하지 못했어요. 올바른 영상 파일인지 확인해주세요.')
  }
  const [width, height] = res.stdout.toString().trim().split(',').map(Number)
  if (!width || !height) {
    throw new Error('영상 크기를 확인하지 못했어요.')
  }
  return { width, height }
}

// region을 직접 주면 그 좌표(px)를 그대로 쓰고, 안 주면 노트북LM 기본 위치(비율 스케일링)를 씀.
export async function removeWatermark(inputPath, outputPath, region) {
  const { width, height } = await probeSize(inputPath)
  const requestedBox = region || {
    x: Math.round(NOTEBOOKLM_WATERMARK_RATIO.x * width),
    y: Math.round(NOTEBOOKLM_WATERMARK_RATIO.y * height),
    w: Math.round(NOTEBOOKLM_WATERMARK_RATIO.w * width),
    h: Math.round(NOTEBOOKLM_WATERMARK_RATIO.h * height),
  }

  const box = {
    x: Math.max(0, Math.min(width - 2, Math.round(Number(requestedBox.x)))),
    y: Math.max(0, Math.min(height - 2, Math.round(Number(requestedBox.y)))),
    w: Math.max(2, Math.round(Number(requestedBox.w))),
    h: Math.max(2, Math.round(Number(requestedBox.h))),
  }
  if (!Object.values(box).every(Number.isFinite)) {
    throw new Error('워터마크 영역 좌표가 올바르지 않아요.')
  }
  box.w = Math.min(box.w, width - box.x)
  box.h = Math.min(box.h, height - box.y)

  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', inputPath,
    '-vf', `delogo=x=${box.x}:y=${box.y}:w=${box.w}:h=${box.h}:show=0`,
    '-map', '0:v:0', '-map', '0:a?',
    '-c:a', 'aac', '-b:a', '192k',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-movflags', '+faststart',
    outputPath,
  ]
  let res
  try {
    res = await run(ffmpegBin(), args)
  } catch (error) {
    throw new Error(`ffmpeg을 실행하지 못했어요 (${error.message}).`)
  }
  if (res.code !== 0) {
    const detail = res.stderr.trim().split(/\r?\n/).pop()
    throw new Error(`워터마크 제거에 실패했어요${detail ? `: ${detail}` : ''}`)
  }
}
