// ============================================================
// 2026-08-04: cloneFill.py(파이썬+OpenCV, 190MB 벤더링 필요)를 그대로 Node.js(sharp)로
// 옮김 - 알고리즘은 동일: 지울 영역을 사용자가 고른 깨끗한 배경으로 덮되, 주변 밝기에 맞춰
// 색을 보정하고 가장자리를 부드럽게(feather) 섞는다. 파이썬 설치가 아예 필요 없어짐.
// ============================================================

import sharp from 'sharp'

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

// regions: [{ x, y, w, h, sourceX, sourceY }] (전부 픽셀 좌표, server.js에서 이미 계산해서 넘김)
export async function cloneFill(inputPath, outputPath, regions) {
  const image = sharp(inputPath)
  const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info // channels는 보통 3(RGB)

  for (const item of regions) {
    let { x, y, w, h, sourceX: sx, sourceY: sy } = item
    w = Math.min(w, width - x, width - sx)
    h = Math.min(h, height - y, height - sy)
    if (w < 2 || h < 2) {
      throw new Error('복제 영역이 너무 작아요.')
    }

    // 1) 주변(타깃 바깥 링) 평균색과 원본(source) 패치 평균색의 차이만큼 source를 보정해서
    // 붙였을 때 "사각형 얼룩"처럼 튀지 않게 한다 (cloneFill.py와 동일한 로직).
    const ringSize = clamp(Math.round(Math.min(w, h) * 0.14), 4, 18)
    const rx0 = Math.max(0, x - ringSize)
    const ry0 = Math.max(0, y - ringSize)
    const rx1 = Math.min(width, x + w + ringSize)
    const ry1 = Math.min(height, y + h + ringSize)

    const ringSum = [0, 0, 0]
    let ringCount = 0
    for (let yy = ry0; yy < ry1; yy++) {
      const inTargetRow = yy >= y && yy < y + h
      for (let xx = rx0; xx < rx1; xx++) {
        if (inTargetRow && xx >= x && xx < x + w) continue // 타깃 영역 자체는 링 평균에서 제외
        const idx = (yy * width + xx) * channels
        ringSum[0] += data[idx]
        ringSum[1] += data[idx + 1]
        ringSum[2] += data[idx + 2]
        ringCount++
      }
    }

    const srcSum = [0, 0, 0]
    const srcCount = w * h
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const idx = ((sy + yy) * width + (sx + xx)) * channels
        srcSum[0] += data[idx]
        srcSum[1] += data[idx + 1]
        srcSum[2] += data[idx + 2]
      }
    }

    const shift = [0, 0, 0]
    if (ringCount > 0) {
      for (let c = 0; c < 3; c++) {
        shift[c] = clamp(ringSum[c] / ringCount - srcSum[c] / srcCount, -80, 80)
      }
    }

    // 2) feather: 경계 안쪽에서만 알파를 0으로 낮추면 딱 그 경계선에서 원본(워터마크) 색이
    // 그대로 남아 네모난 테두리가 보이는 문제가 있었음(실측 확인) - 그래서 선택 영역
    // "바깥"으로도 패딩만큼 살짝 넓혀서, 원래 박스 안쪽은 항상 완전 교체(alpha=1)하고
    // 그 바깥 패딩 구간에서 진짜 주변 픽셀과 자연스럽게 섞이도록(alpha 1→0) 만든다 -
    // 소스 쪽도 같은 크기로 패딩해서 같이 옮겨줌(둘 다 이미지 경계를 안 벗어나는 한도까지).
    const feather = clamp(Math.round(Math.min(w, h) * 0.08), 3, 20)
    const padLeft = Math.min(feather, x, sx)
    const padTop = Math.min(feather, y, sy)
    const padRight = Math.min(feather, width - (x + w), width - (sx + w))
    const padBottom = Math.min(feather, height - (y + h), height - (sy + h))
    const pw = w + padLeft + padRight
    const ph = h + padTop + padBottom

    for (let ly = 0; ly < ph; ly++) {
      const ay = ly < padTop ? (padTop > 0 ? ly / padTop : 1) : ly >= padTop + h ? (padBottom > 0 ? (ph - 1 - ly) / padBottom : 1) : 1
      for (let lx = 0; lx < pw; lx++) {
        const ax = lx < padLeft ? (padLeft > 0 ? lx / padLeft : 1) : lx >= padLeft + w ? (padRight > 0 ? (pw - 1 - lx) / padRight : 1) : 1
        const alpha = ax * ay
        const srcIdx = ((sy - padTop + ly) * width + (sx - padLeft + lx)) * channels
        const dstIdx = ((y - padTop + ly) * width + (x - padLeft + lx)) * channels
        for (let c = 0; c < 3; c++) {
          const srcVal = clamp(data[srcIdx + c] + shift[c], 0, 255)
          data[dstIdx + c] = Math.round(srcVal * alpha + data[dstIdx + c] * (1 - alpha))
        }
      }
    }
  }

  await sharp(data, { raw: { width, height, channels } }).png().toFile(outputPath)
}
