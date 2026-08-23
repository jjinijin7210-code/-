// ============================================================
// "이야기 보따리" - 원본 없이(또는 소재를 바탕으로) 긴 이야기/나레이션을 챕터 단위로 쓰는 모듈.
// 설계 문서(2026-08-23) 최종 결정 사항:
//  - 장르: "자유" / "역사 이야기" 2종. 역사 모드는 소재자료 필수 + 안전장치 프롬프트 고정 삽입.
//  - 말투 "할머니가 도란도란"은 그 자체로 "그 시대를 직접 살아낸 가상 화자" 역할로 재사용.
//  - 화자 생애보다 먼 시대(조선시대 등)는 "할머니의 할머니 이야기" 전승(傳承) 프레임으로 처리.
//  - 분량 20/30/45/60분은 챕터 이어쓰기로 나눠서 생성 (한 번에 다 못 쓰는 길이라서).
// ============================================================

import { callClaude } from './anthropicClient.js'
import { COMMON_STYLE_PRINCIPLES } from './promptBuilder.js'

export const STORY_GENRES = ['free', 'history']

export const STORY_TONES = {
  grandma: '할머니가 손주에게 도란도란 들려주는 정겨운 말투',
  documentary: '다큐멘터리 해설처럼 객관적이고 차분하게',
  emotional: '감정 몰입형 - 듣는 사람이 그 순간에 있는 것처럼',
  plain: '담백한 나레이션',
}

// 분량(분) - 한국어 나레이션 낭독 속도(분당 약 300자, server.js의 video-script 기준과 동일)로
// 목표 글자수를 계산하고, 챕터 하나는 10분 내외로 잡아서 이어쓰기로 나눠 생성한다.
export const STORY_LENGTH_MINUTES = [20, 30, 45, 60]
const CHARS_PER_MINUTE = 300

export function chapterPlan(lengthMinutes) {
  const minutes = STORY_LENGTH_MINUTES.includes(Number(lengthMinutes)) ? Number(lengthMinutes) : 20
  const chapterCount = Math.max(2, Math.round(minutes / 10))
  const charsPerChapter = Math.round((minutes * CHARS_PER_MINUTE) / chapterCount)
  return { minutes, chapterCount, charsPerChapter }
}

// 3층(장르 조건부) - 역사 이야기 모드 전용 안전장치. 문체(1층)보다 우선한다고 명시하는 게 핵심:
// "할머니가 도란도란" 같은 부드러운 톤이 "편하게 지어내도 된다"는 착각으로 이어지지 않게 함.
function buildHistorySafetyBlock(sourceText, isGrandmaTone) {
  const narratorRule = isGrandmaTone
    ? `1. 화자는 그 시대를 직접 살아낸 가상의 할머니입니다. 손주에게 옛날이야기를 들려주듯
   정겨운 말투로 서술하되, 화자 자신의 이름·신상은 실존 인물과 겹치지 않는 완전한
   가상 인물이어야 합니다.`
    : `1. 서술에 화자(내레이터)가 등장하는 경우, 그 화자는 실존 인물과 겹치지 않는 완전한
   가상 인물이어야 합니다. 실존 인물을 화자로 세우지 마십시오.`

  return `[역사 이야기 모드 — 필수 준수 사항]
${narratorRule}
2. 아래 <소재자료>에 명시된 사실(인물, 연도, 사건, 수치, 인과관계, 실제 기록된 발언)만
   사용해서 서술하십시오. 제공되지 않은 사실을 창작하거나 추정하거나 각색하지 마십시오.
3. <소재자료>에 없는 세부 사항(대사, 감정, 정황)이 필요할 경우:
   - 화자(가상 인물) 자신의 감정·개인적 경험·소감은 자유롭게 창작 가능합니다.
   - 그러나 실존 인물(소재자료에 등장하는 인물)에게는 소재자료에 없는 대사나
     행적을 임의로 지어 붙이지 마십시오. 실존 인물의 행적은 화자가 "듣거나
     목격한 것"으로만 전달하십시오.
   - 실존 인물의 발언은 소재자료에 실제 기록된 것만 그대로 인용하십시오.
4. 연도·수치·인명 등 구체적 사실관계는 <소재자료>와 정확히 일치해야 합니다.
   확실하지 않은 부분은 얼버무리지 말고 언급을 생략하거나 "구체적 기록은 확인되지
   않는다"라고 명시하십시오.
5. 위 원칙은 정겨운 말투·감정 표현·분량 조절 등 다른 어떤 스타일 지시(공통 문체 원칙 포함)보다
   우선합니다. 톤이 부드럽다고 해서 사실관계 검증 기준이 낮아지지 않습니다.
6. 화자가 다루는 시대가 화자 자신의 생애보다 앞선 경우(조선시대 등), "화자가 자신의
   윗대 어른(할머니, 증조할머니 등)에게 전해 들은 이야기를 손주에게 다시 들려주는"
   전승(傳承) 구조로 서술하십시오. 이 전승 구조를 쓰더라도 2~4번 원칙(소재자료 밖 사실 창작
   금지, 실존 인물 임의 대사 금지)은 동일하게 적용됩니다. 전승이라는 형식은 시대적 거리감을
   자연스럽게 메우기 위한 장치일 뿐, 사실관계 검증 기준을 낮추는 근거가 아닙니다.
7. 순수 내레이션 텍스트로만 작성하고, 효과음/화면지문/BGM 지시어는 넣지 마십시오.

<소재자료>
${sourceText}
</소재자료>`
}

// 이어쓰기용 - 앞 챕터들의 흐름을 짧게 요약해 넘겨받아 다음 챕터가 자연스럽게 이어지게 함.
// (앞 챕터 전문을 다 넣으면 프롬프트가 너무 커져서, 요약 + 마지막 문단만 넘긴다)
function buildContinuationNote(previousChapters) {
  if (!Array.isArray(previousChapters) || !previousChapters.length) return ''
  const summaries = previousChapters
    .map((ch, i) => `${i + 1}장 "${ch.title || `챕터 ${i + 1}`}": ${String(ch.summary || '').slice(0, 400)}`)
    .join('\n')
  const lastTail = String(previousChapters[previousChapters.length - 1].tail || '').slice(-600)
  return `
[지금까지의 이야기 - 이어쓰기]
${summaries}

직전 챕터의 마지막 부분(이 문장 뒤에 자연스럽게 이어지게 쓰십시오. 같은 내용을 반복하지 마십시오):
"...${lastTail}"`
}

export async function generateStoryChapter({
  genre = 'free',
  source = {},
  tone = 'grandma',
  lengthMinutes = 20,
  chapterIndex = 0,
  previousChapters = [],
}) {
  const isHistory = genre === 'history'
  const sourceText = String(source.text || '').trim()
  if (isHistory && sourceText.length < 50) {
    throw new Error('역사 이야기 모드에서는 소재 자료(사료 원문 등)를 충분히 넣어야 해요. 여기 넣은 자료 안의 사실만 사용해서 대본을 만들어요.')
  }

  const { minutes, chapterCount, charsPerChapter } = chapterPlan(lengthMinutes)
  const idx = Math.max(0, Math.min(Number(chapterIndex) || 0, chapterCount - 1))
  const toneLabel = STORY_TONES[tone] || STORY_TONES.grandma
  const isGrandmaTone = tone === 'grandma'

  const position =
    idx === 0
      ? '첫 챕터입니다. 듣는 사람을 이야기 속으로 끌어들이는 도입으로 시작하십시오.'
      : idx === chapterCount - 1
        ? '마지막 챕터입니다. 이야기를 여운 있게 마무리하십시오.'
        : '중간 챕터입니다. 긴장과 흐름을 유지하며 다음이 궁금해지게 끝내십시오.'

  // 계층 순서(8-3): 1층 공통 문체 → 3층 장르 안전장치(역사일 때만, 문체보다 우선) → 4층 사용자 입력
  const system = `${COMMON_STYLE_PRINCIPLES}

당신은 오디오로 낭독될 긴 이야기(나레이션 대본)를 쓰는 작가입니다.
${isHistory ? `\n${buildHistorySafetyBlock(sourceText, isGrandmaTone)}\n` : ''}
[이야기 설정]
- 말투: ${toneLabel}
- 전체 분량: 약 ${minutes}분 분량을 ${chapterCount}개 챕터로 나눠 씁니다.
- 지금 쓸 챕터: ${idx + 1}/${chapterCount}장. ${position}
- 이 챕터 분량: 한글 기준 약 ${charsPerChapter}자 내외 (낭독 속도 분당 약 ${CHARS_PER_MINUTE}자 기준).
- 순수 내레이션 텍스트로만 쓰고, 효과음/화면지문 표시는 넣지 마십시오.
${!isHistory && sourceText ? `\n[배경/소재 참고]\n${sourceText.slice(0, 8000)}` : ''}
${buildContinuationNote(previousChapters)}

반드시 아래 형식으로만 출력하십시오 (다른 설명 없이):
첫 줄: 챕터 제목 (짧게)
둘째 줄부터: 챕터 본문`

  const userText = isHistory
    ? `위 <소재자료>만을 근거로 ${idx + 1}번째 챕터를 써주세요.`
    : `${source.title ? `주제: ${source.title}\n` : ''}${idx + 1}번째 챕터를 써주세요.`

  const raw = await callClaude({
    system,
    messages: [{ role: 'user', content: userText }],
    // 챕터당 3,000자 내외 한국어 - 토큰 여유를 넉넉히 (잘리면 이어쓰기 흐름이 깨짐)
    maxTokens: Math.min(8000, Math.round(charsPerChapter * 2.2)),
  })

  const lines = String(raw).trim().split('\n')
  const title = (lines.shift() || `챕터 ${idx + 1}`).replace(/^#+\s*/, '').replace(/^챕터\s*\d+[.:]?\s*/, '').trim() || `챕터 ${idx + 1}`
  const text = lines.join('\n').trim()
  if (text.length < 100) throw new Error('챕터 내용을 충분히 만들지 못했어요. 다시 시도해 주세요.')

  return {
    chapterIndex: idx,
    chapterCount,
    title,
    text,
    // 다음 챕터 이어쓰기에 쓸 요약 재료 - 클라이언트가 그대로 previousChapters로 되돌려 보냄
    summary: text.slice(0, 400),
    tail: text.slice(-600),
    done: idx >= chapterCount - 1,
  }
}
