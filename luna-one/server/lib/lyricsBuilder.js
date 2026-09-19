// ============================================================
// "가사 쓰기" - Suno에 바로 붙여넣을 [Verse]/[Chorus] 구조 태그 가사를 만드는 모듈.
// 설계 문서(2026-08-23) 9장: 숏폼 알고리즘이 완주율을 중요하게 봐서, 최근 트렌드는
// 곡 전체를 1분 30초~2분 내외로 짧게 뽑고 후렴을 곡 초반에 바로 배치하는 방식이 유리 -
// 이걸 곡 길이 기본값으로 반영한다. 트렌드는 계속 바뀌니 하드코딩 대신 옵션 목록으로 두고,
// 유행이 바뀌면 SONG_LENGTHS만 업데이트하면 되게 설계.
// ============================================================

import { callClaudeJson } from './anthropicClient.js'
import { tryParseJsonLoose } from './jsonRepair.js'
import { COMMON_STYLE_PRINCIPLES } from './promptBuilder.js'

export const SONG_LENGTHS = {
  short: { label: '1:30~2:00 (숏폼 추천)', isDefault: true },
  single: { label: '2:30~3:00 (일반 싱글 길이)' },
  custom: { label: '직접 지정' },
}

// 곡 길이별 구조 지침 - 출력 형식(태그 구조)은 그대로 두고 곡 분량(Verse/Chorus 반복)만 조절.
// ⚠ 분량을 줄인다고 반복까지 줄이면 안 됨: Verse는 1개로 줄여도 Chorus 반복은 최소 2회 이상
// 유지가 원칙 (짧은 곡일수록 후렴 반복 비중이 높아야 귀에 남음).
function buildLengthRule(songLength, customLength) {
  if (songLength === 'short') {
    return `[가사 작성 지침 — 곡 길이: 1:30~2:00 (숏폼 추천)]
기존 가사 출력 형식(Suno용 [Verse]/[Chorus] 구조 태그, Verse+Chorus 조합 방식)은
그대로 유지하되, 전체 길이만 1분 30초~2분에 맞춰 짧게 줄이십시오.
- 형식은 동일: [Verse] → [Chorus] 순서의 기존 구조 태그 그대로 사용.
- 다만 Verse는 1개만 쓰고, Chorus는 최소 2회 이상 반복해 곡 전체 분량을 짧게 줄이십시오
  (짧아지는 건 Verse 쪽이고, Chorus 반복은 줄이지 않습니다).
- 후렴(Chorus)이 늦어도 30초~40초 안에는 등장하도록 배치하십시오
  (숏폼에서는 도입이 길면 이탈률이 높아짐).
- 불필요한 간주/브릿지는 최소화하고, 짧고 강렬한 훅 위주로 구성하십시오.
- 가사 자체도 짧고 반복적인 문구 위주로 쓰십시오. 한 줄은 짧게, 핵심 문구(훅 라인)는
  후렴에서 2회 이상 반복해 귀에 남게 하십시오. 쉽고 짧은 단어를 리듬감 있게 반복하는
  트로트 히트곡 스타일(예: 반복형 후렴 훅)을 기본으로 합니다.`
  }
  if (songLength === 'single') {
    return `[가사 작성 지침 — 곡 길이: 2:30~3:00 (일반 싱글)]
Suno용 [Verse]/[Chorus] 구조 태그를 그대로 쓰되, Verse 2개 + Chorus 2~3회 반복 +
필요하면 짧은 [Bridge] 1개로 2분 30초~3분 분량에 맞추십시오.`
  }
  return `[가사 작성 지침 — 곡 길이: ${customLength || '사용자 지정'}]
Suno용 [Verse]/[Chorus] 구조 태그를 그대로 쓰되, 전체 분량을 위 길이에 맞춰
Verse/Chorus 반복 횟수를 조절하십시오. 어떤 길이든 Chorus(후렴) 반복은 최소 2회
이상 유지하십시오.`
}

export async function generateLyrics({ theme, mood = '', songLength = 'short', customLength = '' }) {
  const themeText = String(theme || '').trim()
  if (themeText.length < 2) throw new Error('어떤 이야기/주제로 가사를 쓸지 먼저 넣어 주세요.')
  const lengthKey = SONG_LENGTHS[songLength] ? songLength : 'short'

  const system = `${COMMON_STYLE_PRINCIPLES}

당신은 Suno 같은 AI 작곡 도구에 바로 붙여넣을 가사를 쓰는 작사가입니다.
- 가사는 [Verse], [Chorus], (필요시) [Bridge], [Outro] 구조 태그로 구분해 쓰십시오.
- 태그는 영어로, 가사는 한국어로 쓰십시오.
- 후렴의 훅 라인은 쉽고 짧은 단어로, 한 번 들으면 따라 부를 수 있게 쓰십시오.

${buildLengthRule(lengthKey, customLength)}

추가로 Suno의 스타일 프롬프트 칸에 넣을 영어 스타일 태그(styleTags)도 만들어 주세요 -
장르/분위기/템포 위주로, 곡 길이가 숏폼용이면 "short song, catchy hook" 같은 길이 관련
태그도 포함하십시오.

반드시 아래 JSON 형식만 출력하세요. 다른 설명은 붙이지 마세요.
{"title":"곡 제목","styleTags":"영어 스타일 태그 (쉼표로 구분)","lyrics":"[Verse]\\n...\\n\\n[Chorus]\\n..."}`

  const userText = `주제/이야기: ${themeText}${mood ? `\n분위기/장르: ${mood}` : ''}${lengthKey === 'custom' && customLength ? `\n곡 길이: ${customLength}` : ''}`

  return callClaudeJson({
    system,
    messages: [{ role: 'user', content: userText }],
    maxTokens: 2000,
    maxRetries: 2,
    parse: (text) => {
      const parsed = tryParseJsonLoose(text)
      if (!parsed || typeof parsed.lyrics !== 'string' || !parsed.lyrics.trim()) throw new Error('가사 JSON 파싱 실패')
      return {
        title: String(parsed.title || '제목 없음'),
        styleTags: String(parsed.styleTags || ''),
        lyrics: parsed.lyrics.trim(),
      }
    },
  })
}
