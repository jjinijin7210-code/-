// ============================================================
// 증거 첨부파일 (계획서 4장)
//
// "QA 체크박스만 두지 말고 실제로 첨부할 수 있게" - 실행 화면 이미지 / 테스트 로그 /
// 오류 화면 / 작업 파일 / 수정 전후 비교를 실제 파일로 첨부하고, 첨부가 없으면
// 관련 체크박스를 체크할 수 없게 만드는 로직입니다.
//
// File/Blob/btoa는 브라우저와 Node.js(v18+) 양쪽에 모두 있는 표준 API라서,
// 이 파일은 브라우저 코드 그대로 Node.js에서도 실행/테스트할 수 있습니다.
// (테스트: scripts/test-attachments.mjs)
// ============================================================

export const ATTACHMENT_KINDS = [
  { key: 'screenshot', label: '실행 화면 이미지' },
  { key: 'test_log', label: '테스트 로그' },
  { key: 'error_screen', label: '오류 화면' },
  { key: 'work_file', label: '작업 파일' },
  { key: 'before_after', label: '수정 전/후 비교' },
]

// localStorage 용량(보통 5~10MB) 안에서 여러 첨부를 감당하려면 파일당 크기를 제한해야 함
export const MAX_ATTACHMENT_SIZE = 3 * 1024 * 1024 // 3MB

function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'att-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

// ArrayBuffer -> base64 문자열 (브라우저/Node 공통, Buffer에 의존하지 않음)
export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000 // 큰 파일에서 콜스택 넘치는 것 방지
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

// 첨부하기 전에 파일이 너무 크지 않은지 확인
export function validateFile(file) {
  if (!file) return { ok: false, error: '파일이 없어요.' }
  if (file.size > MAX_ATTACHMENT_SIZE) {
    const mb = (MAX_ATTACHMENT_SIZE / (1024 * 1024)).toFixed(0)
    return { ok: false, error: `파일이 너무 커요 (최대 ${mb}MB까지 첨부할 수 있어요).` }
  }
  return { ok: true }
}

// 사진(폰/카메라 원본은 보통 3~8MB)을 큰 변화 없이 화면에서 보기엔 충분한 크기로 줄여서
// 대부분 3MB 제한에 안 걸리게 함 - 사용자가 직접 파일을 줄여올 필요 없게 하는 게 목적.
export async function compressImageFile(file, { maxDimension = 1600, quality = 0.82 } = {}) {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file // 압축이 오히려 더 크면 원본 그대로 사용
    const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], newName, { type: 'image/jpeg' })
  } catch {
    return file // 압축 실패해도 원본으로 계속 진행 (아래 크기 체크에서 걸릴 수는 있음)
  }
}

// File -> data URL 문자열 (참고 이미지를 서버로 그대로 보낼 때처럼, 첨부 레코드가 아니라
// 순수 data URL 자체가 필요한 경우에 사용)
export async function fileToDataUrl(file) {
  const buffer = await file.arrayBuffer()
  const base64 = arrayBufferToBase64(buffer)
  const mimeType = file.type || 'application/octet-stream'
  return `data:${mimeType};base64,${base64}`
}

// 실제 File 객체를 localStorage/DB에 저장 가능한 첨부 레코드로 변환
export async function fileToAttachment(file, kind, note = '') {
  const target = await compressImageFile(file)
  const check = validateFile(target)
  if (!check.ok) throw new Error(check.error)
  file = target

  const buffer = await file.arrayBuffer()
  const base64 = arrayBufferToBase64(buffer)
  const mimeType = file.type || 'application/octet-stream'

  return {
    id: genId(),
    kind,
    filename: file.name,
    mime_type: mimeType,
    size: file.size,
    data_url: `data:${mimeType};base64,${base64}`,
    note,
    created_at: new Date().toISOString(),
  }
}

// 특정 종류(kind)의 첨부가 하나라도 있는지
export function hasAttachmentOfKind(attachments, kind) {
  return (attachments || []).some((a) => a.kind === kind)
}

// 체크박스를 체크해도 되는지 - 첨부 없이는 절대 true가 될 수 없음
export function canCheckEvidence(kind, attachments) {
  return hasAttachmentOfKind(attachments, kind)
}
