import React, { useState } from 'react'

export default function CapCutOneStop() {
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

  const handleGenerate = async () => {
    if (!topic.trim()) {
      alert('주제나 대본 내용을 입력해 주세요!')
      return
    }

    setLoading(true)
    setResult(null)

    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: '유튜브(한국어)',
          topic: `${topic} (CapCut 캡컷 대본으로 영상 만들기 전용 숏폼 대본)`,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '대본 생성 실패')

      const bodyText = data.body || data.content || ''
      const lines = bodyText.split('\n').filter((l) => l.trim().length > 0)

      // CapCut SRT 자막 파일 구성
      let srtContent = ''
      let sec = 0
      lines.forEach((line, idx) => {
        const startSec = sec
        const endSec = sec + 3
        const formatTime = (s) => {
          const m = String(Math.floor(s / 60)).padStart(2, '0')
          const ss = String(s % 60).padStart(2, '0')
          return `00:${m}:${ss},000`
        }
        srtContent += `${idx + 1}\n${formatTime(startSec)} --> ${formatTime(endSec)}\n${line.trim()}\n\n`
        sec += 3
      })

      setResult({
        title: data.title || topic,
        script: bodyText,
        srt: srtContent,
      })
    } catch (e) {
      alert(`생성 실패: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleCopyScript = () => {
    if (!result) return
    navigator.clipboard.writeText(result.script)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownloadSrt = () => {
    if (!result) return
    const blob = new Blob([result.srt], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `CapCut_자막_${Date.now()}.srt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1e1b4b 0%, #311b92 100%)',
      borderRadius: '16px',
      padding: '20px',
      color: '#fff',
      boxShadow: '0 8px 32px rgba(49, 27, 146, 0.4)',
      marginBottom: '24px',
      border: '1px solid rgba(168, 85, 247, 0.3)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <span style={{ fontSize: '28px' }}>🎬</span>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#f3e8ff' }}>
            1-Click CapCut(캡컷) 영상 자동 연동 엔진
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#c084fc' }}>
            대본만 넣으면 캡컷(CapCut) '대본으로 영상 만들기'와 1초 만에 자동 연결하여 100% 무료 영상 완성!
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="예: 트롯 가수 성공 비하인드 스토리, 저소음 가습기 추천 팁..."
          style={{
            flex: 1,
            padding: '12px 14px',
            borderRadius: '10px',
            border: '1px solid #7e22ce',
            background: 'rgba(15, 23, 42, 0.8)',
            color: '#fff',
            fontSize: '14px',
            outline: 'none'
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
        />
        <button
          onClick={handleGenerate}
          disabled={loading}
          style={{
            padding: '12px 20px',
            borderRadius: '10px',
            border: 0,
            background: 'linear-gradient(90deg, #a855f7 0%, #ec4899 100%)',
            color: '#fff',
            fontWeight: 800,
            fontSize: '14px',
            cursor: loading ? 'wait' : 'pointer',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 15px rgba(168, 85, 247, 0.4)'
          }}
        >
          {loading ? '🔮 캡컷 대본 생성 중...' : '🚀 CapCut 대본 & 자막 1초 완성'}
        </button>
      </div>

      {result && (
        <div style={{
          background: 'rgba(15, 23, 42, 0.9)',
          borderRadius: '12px',
          padding: '16px',
          border: '1px solid #9333ea',
          marginTop: '14px'
        }}>
          <h3 style={{ margin: '0 0 10px', fontSize: '16px', color: '#e9d5ff' }}>
            📌 완성된 캡컷 대본: {result.title}
          </h3>

          <textarea
            readOnly
            value={result.script}
            rows={5}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '8px',
              background: '#0f172a',
              border: '1px solid #4c1d95',
              color: '#cbd5e1',
              fontSize: '13px',
              resize: 'vertical',
              marginBottom: '12px'
            }}
          />

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={handleCopyScript}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: 0,
                background: copied ? '#16a34a' : '#9333ea',
                color: '#fff',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              {copied ? '✅ 대본 복사 완료! (캡컷에 붙여넣기하세요)' : '📋 CapCut 대본 1초 복사하기'}
            </button>

            <button
              onClick={handleDownloadSrt}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid #c084fc',
                background: 'transparent',
                color: '#e9d5ff',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              📥 CapCut 자막 (.srt 파일 다운로드)
            </button>
          </div>

          <div style={{
            marginTop: '12px',
            padding: '10px',
            borderRadius: '8px',
            background: 'rgba(88, 28, 135, 0.4)',
            fontSize: '12px',
            color: '#d8b4fe'
          }}>
            💡 <b>CapCut 사용법</b>: 캡컷 앱/웹 실행 ➡️ <b>[대본으로 영상 만들기 (Script to Video)]</b> 클릭 ➡️ 위 복사한 대본 붙여넣기 ➡️ 10초 만에 AI 비디오 & 음성 100% 무료 완성!
          </div>
        </div>
      )}
    </div>
  )
}
