import React, { useState } from 'react'

export default function EconomyBenchmarkGenerator() {
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const handleGenerate = async () => {
    if (!topic.trim()) {
      alert('경제/재테크 주제를 입력해 주세요!')
      return
    }

    setLoading(true)
    setResult(null)

    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: '경제/재테크',
          topic: `${topic} (조회수 100만 뷰 경제 썸네일 & 숏폼 대본)`,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '생성 실패')

      const imgRes = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `3d cute round character holding money stack in front of glowing stock chart, dark background, yellow and magenta neon highlights, 8k resolution, thumbnail illustration for ${topic}`,
          size: '1024x1024'
        })
      }).then(r => r.json()).catch(() => ({}))

      setResult({
        title: data.title || topic,
        body: data.body || data.content,
        imageUrl: imgRes.dataUrl || 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800'
      })
    } catch (e) {
      alert(`생성 실패: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
      borderRadius: '16px',
      padding: '20px',
      color: '#fff',
      boxShadow: '0 8px 32px rgba(15, 23, 42, 0.5)',
      marginBottom: '24px',
      border: '1px solid rgba(234, 179, 8, 0.4)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <span style={{ fontSize: '28px' }}>📊</span>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#fef08a' }}>
            100만 뷰 경제/재테크 썸네일 & 숏폼 전용 엔진
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#fde047' }}>
            검은 배경 + 노랑/분홍 3단 텍스트 + 귀여운 3D 마스코트 캐릭터 100만 뷰 대박 패턴 1초 생성!
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="예: S&P500 노후 연금 저축 펀드, 1억 빠르게 모으는 법, ISA 계좌 3년 만기..."
          style={{
            flex: 1,
            padding: '12px 14px',
            borderRadius: '10px',
            border: '1px solid #ca8a04',
            background: 'rgba(15, 23, 42, 0.9)',
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
            background: 'linear-gradient(90deg, #eab308 0%, #ec4899 100%)',
            color: '#0f172a',
            fontWeight: 800,
            fontSize: '14px',
            cursor: loading ? 'wait' : 'pointer',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 15px rgba(234, 179, 8, 0.4)'
          }}
        >
          {loading ? '🔮 100만 뷰 썸네일/대본 생성 중...' : '🚀 100만 뷰 경제 썸네일 1초 완공'}
        </button>
      </div>

      {result && (
        <div style={{
          background: 'rgba(15, 23, 42, 0.95)',
          borderRadius: '12px',
          padding: '16px',
          border: '1px solid #eab308',
          marginTop: '14px',
          display: 'grid',
          gridTemplateColumns: '220px 1fr',
          gap: '16px'
        }}>
          <img
            src={result.imageUrl}
            alt="경제 썸네일"
            style={{
              width: '100%',
              height: '140px',
              objectFit: 'cover',
              borderRadius: '10px',
              border: '2px solid #fde047'
            }}
          />
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#fef08a' }}>
              📌 {result.title}
            </h3>
            <textarea
              readOnly
              value={result.body}
              rows={4}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '8px',
                background: '#0f172a',
                border: '1px solid #854d0e',
                color: '#cbd5e1',
                fontSize: '12px',
                resize: 'none'
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
