// 해외(중국 등) 링크에서 영상을 받아오는 도구 - 쇼핑쇼츠 벤치마킹용 참고 시청이 목적이며,
// 받은 영상을 그대로 재업로드하는 용도가 아님(사용자에게도 안내함).
// yt-dlp(무료 오픈소스 다운로더)를 그대로 감싸서 씀 - 도우인/웨이보/빌리비리 등 대부분 지원.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { GENERATED_DIR } from './shortsGenerator.js'

// videoRenderer.js의 FFMPEG_PATH 패턴과 동일하게, 로컬 PC마다 PATH가 다를 수 있어 env로 덮어쓸 수 있게 함.
function ytdlpBin() {
  return process.env.YTDLP_PATH || 'yt-dlp'
}

export async function downloadVideoFromUrl(url) {
  if (!url || !/^https?:\/\//.test(url)) {
    throw new Error('올바른 링크(http:// 또는 https://로 시작)를 넣어주세요.')
  }

  fs.mkdirSync(GENERATED_DIR, { recursive: true })
  const id = crypto.randomUUID().slice(0, 8)
  const outputTemplate = path.join(GENERATED_DIR, `dl-${id}.%(ext)s`)

  const res = spawnSync(
    ytdlpBin(),
    ['--no-playlist', '--merge-output-format', 'mp4', '-o', outputTemplate, url],
    { encoding: 'utf-8' }
  )
  if (res.error) {
    throw new Error(`yt-dlp를 실행하지 못했어요 (${res.error.message}). yt-dlp가 설치되어 있는지 확인해주세요.`)
  }
  if (res.status !== 0) {
    const tail = (res.stderr || '').trim().split('\n').slice(-3).join(' / ')
    throw new Error(`영상을 받아오지 못했어요: ${tail || '알 수 없는 오류'}`)
  }

  const prefix = `dl-${id}.`
  const files = fs.readdirSync(GENERATED_DIR).filter((f) => f.startsWith(prefix))
  if (files.length === 0) {
    throw new Error('다운로드는 끝났는데 파일을 찾지 못했어요.')
  }
  const fileName = files[0]

  // 제목은 다운로드 성공 후 별도로 가볍게 조회 - 실패해도 다운로드 자체는 이미 성공이라 무시하고 넘어감.
  let title = fileName
  const metaRes = spawnSync(
    ytdlpBin(),
    ['--no-playlist', '--skip-download', '--print', '%(title)s', url],
    { encoding: 'utf-8' }
  )
  if (metaRes.status === 0 && metaRes.stdout?.trim()) {
    title = metaRes.stdout.trim().split('\n')[0]
  }

  return { fileName, videoUrl: `/generated/${fileName}`, title }
}

// 받아둔 영상 파일 삭제 - 우리가 만든 이름(dl-<id>.<ext>)만 허용해서 다른 경로를 못 건드리게 함.
export function deleteDownloadedVideo(fileName) {
  if (!fileName || !/^dl-[a-f0-9]{8}\.[a-z0-9]+$/i.test(fileName)) {
    throw new Error('삭제할 수 없는 파일 이름이에요.')
  }
  const filePath = path.join(GENERATED_DIR, fileName)
  if (!fs.existsSync(filePath)) {
    throw new Error('이미 삭제된 파일이에요.')
  }
  fs.unlinkSync(filePath)
}
