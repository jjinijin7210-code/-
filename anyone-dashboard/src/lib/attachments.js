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

// 실제 File 객체를 localStorage/DB에 저장 가능한 첨부 레코드로 변환
export async function fileToAttachment(file, kind, note = '') {
  const check = validateFile(file)
  if (!check.ok) throw new Error(check.error)

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
