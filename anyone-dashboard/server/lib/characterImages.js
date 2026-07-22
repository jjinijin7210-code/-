// ============================================================
// 심리학 영상에 쓸 캐릭터 이미지 선택기 - server/assets/characters/ 폴더에 진희님이 직접
// 만든 캐릭터 이미지를 넣어두면 AI로 새로 생성하지 않고 그 이미지들을 그대로(돌려가며) 씀.
// 폴더가 비어있으면 null(빈 배열)을 돌려주고, 그러면 기존처럼 AI가 이미지를 생성한다.
// ============================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const CHARACTER_DIR = path.join(__dirname, '..', 'assets', 'characters')

export function listCharacterImages() {
  if (!fs.existsSync(CHARACTER_DIR)) return []
  return fs
    .readdirSync(CHARACTER_DIR)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .map((f) => path.join(CHARACTER_DIR, f))
}

// 정지 이미지 대신 쓸 수 있는 짧은 입모양 애니메이션 클립(2026-07-22, 진희님이 테스트한 5종:
// 중립x2/기쁨/화남/무서움). 같은 폴더에 mp4로 넣어두면 자동 인식.
function listCharacterVideos() {
  if (!fs.existsSync(CHARACTER_DIR)) return []
  return fs
    .readdirSync(CHARACTER_DIR)
    .filter((f) => /\.(mp4|mov|webm)$/i.test(f))
    .map((f) => path.join(CHARACTER_DIR, f))
}

// 영상 파일명(kokoro_talk_neutral2.mp4 등)에서 표정 이름만 뽑아서, 같은 표정의 정지 이미지
// (kokoro_neutral.png)와 짝지을 때 씀 - 뒤에 붙은 숫자(neutral2의 "2")는 같은 표정의 다른
// 버전이라는 뜻이라 무시한다.
function baseEmotionName(filePath) {
  const name = path.basename(filePath, path.extname(filePath))
  const m = /^kokoro_talk_([a-z]+?)\d*$/i.exec(name)
  return m ? m[1].toLowerCase() : null
}

// 씬에 쓸 캐릭터 소스 목록 - 입모양 애니메이션 영상이 정지 이미지보다 생동감 있어서
// 우선 사용하고, 영상이 부족하면 정지 이미지로 나머지를 채운다.
// 2026-07-22: "혹시 모르니까" 정지 이미지도 같이 넣어두자는 요청 - 영상은 이미 폴더에서
// 안 지우고 그대로 뒀지만, 그것만으론 영상 개수가 maxUniqueImages를 채우면 이미지가 순서상
// 밀려서 실제로는 안 쓰임. 그래서 진짜 안전장치로 각 영상에 같은 표정의 정지 이미지를
// fallbackSrc로 짝지어줌 - 영상 렌더링이 실패하면 videoRenderer.js가 이걸로 자동 대체한다.
export function listCharacterAssets() {
  const images = listCharacterImages()
  const imageByEmotion = new Map()
  for (const src of images) {
    const name = path.basename(src, path.extname(src)).replace(/^kokoro_/i, '').toLowerCase()
    if (!imageByEmotion.has(name)) imageByEmotion.set(name, src)
  }

  const videos = listCharacterVideos().map((src) => {
    const emotion = baseEmotionName(src)
    return { src, isVideo: true, fallbackSrc: emotion ? imageByEmotion.get(emotion) : undefined }
  })
  return [...videos, ...images.map((src) => ({ src, isVideo: false }))]
}
