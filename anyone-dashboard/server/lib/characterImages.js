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
