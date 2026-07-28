// 이미지 형식 변환 (예: Meta AI가 만들어주는 webp 파일을 jpg로) - ffmpeg를 그대로 재사용해서
// 새 의존성(sharp 등) 추가 없이 구현. 결과는 파일로 남기지 않고 바로 data URL로 돌려줘서
// (videoDownloader.js의 GENERATED_DIR 방식과 달리) 삭제할 서버 파일 자체가 없음.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function ffmpegBin() {
  return process.env.FFMPEG_PATH || 'ffmpeg'
}

const MIME_BY_FORMAT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

export async function convertImageFormat({ imageDataUrl, format }) {
  const targetFormat = (format || 'jpg').toLowerCase()
  if (!MIME_BY_FORMAT[targetFormat]) {
    throw new Error(`지원하지 않는 형식이에요: ${format} (jpg/png/webp만 가능)`)
  }

  const match = /^data:(.+?);base64,(.+)$/.exec(imageDataUrl || '')
  if (!match) {
    throw new Error('이미지 파일이 올바르지 않아요.')
  }
  const buffer = Buffer.from(match[2], 'base64')

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anyone-img-convert-'))
  const inputPath = path.join(tmpDir, 'input')
  const outputExt = targetFormat === 'jpeg' ? 'jpg' : targetFormat
  const outputPath = path.join(tmpDir, `output.${outputExt}`)

  try {
    fs.writeFileSync(inputPath, buffer)

    // jpg는 알파 채널을 못 받으니, 투명 배경이 있는 png/webp를 jpg로 바꿀 때 검은 배경이 되는 걸
    // 막기 위해 흰 배경에 합성함. 원본이 이미 불투명 사진이면(이번 요청 이미지처럼) 이 필터를 거쳐도 그대로 나옴.
    const args =
      outputExt === 'jpg'
        ? [
            '-y',
            '-i',
            inputPath,
            '-filter_complex',
            'color=white,format=rgb24[bg];[bg][0:v]scale2ref[bg][fg];[bg][fg]overlay=format=auto:shortest=1',
            '-q:v',
            '2',
            outputPath,
          ]
        : ['-y', '-i', inputPath, outputPath]

    const res = spawnSync(ffmpegBin(), args, { encoding: 'utf-8' })
    if (res.error) {
      throw new Error(`ffmpeg을 실행하지 못했어요 (${res.error.message}). ffmpeg이 설치되어 있는지 확인해주세요.`)
    }
    if (res.status !== 0) {
      const tail = (res.stderr || '').trim().split('\n').slice(-3).join(' / ')
      throw new Error(`이미지 변환에 실패했어요: ${tail || '알 수 없는 오류'}`)
    }

    const outBuffer = fs.readFileSync(outputPath)
    const mime = MIME_BY_FORMAT[targetFormat]
    return `data:${mime};base64,${outBuffer.toString('base64')}`
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
