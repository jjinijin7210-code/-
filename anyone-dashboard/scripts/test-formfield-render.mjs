// FormField.jsx가 실제로 <input required>, <textarea required> 등을 만드는지
// react-dom/server로 "진짜 렌더링"해서 확인하는 테스트.
//
// JSX 파일을 node가 바로 읽을 수 없어서, 프로젝트에 이미 설치된 esbuild(Vite의 의존성)로
// 먼저 순수 JS로 변환한 뒤 react-dom/server로 렌더링합니다.
//
// 실행: npm install 이후 → node scripts/test-formfield-render.mjs

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

function findEsbuild() {
  const candidates = [
    path.join(projectRoot, 'node_modules', '.bin', 'esbuild'),
    path.join(projectRoot, 'node_modules', 'esbuild', 'bin', 'esbuild'),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

const esbuildBin = findEsbuild()
if (!esbuildBin) {
  console.log('⚠️  esbuild를 찾지 못했어요. 먼저 `npm install`을 실행한 뒤 다시 시도해주세요.')
  console.log('   (esbuild는 Vite의 의존성으로 자동 설치됩니다.)')
  process.exit(1)
}

const tmpDir = path.join(projectRoot, '.tmp-test-render')
if (!existsSync(tmpDir)) mkdirSync(tmpDir)
const outFile = path.join(tmpDir, 'FormField.mjs')

execFileSync(esbuildBin, [
  path.join(projectRoot, 'src/components/FormField.jsx'),
  '--bundle',
  '--external:react',
  '--external:react-dom',
  '--jsx=automatic',
  '--format=esm',
  `--outfile=${outFile}`,
])

const { renderToStaticMarkup } = await import('react-dom/server')
const React = (await import('react')).default
const { default: FormField } = await import(outFile)

let passed = 0
function check(name, cond) {
  if (cond) {
    console.log(`  ✅ ${name}`)
    passed++
  } else {
    console.log(`  ❌ ${name}`)
    process.exitCode = 1
  }
}

console.log('=== FormField 실제 렌더링 검증 (react-dom/server) ===')

const html1 = renderToStaticMarkup(
  React.createElement(FormField, { label: '제목', type: 'text', required: true, value: '', onChange: () => {} })
)
check('text 필드 required=true → <input ... required> 실제로 생성됨', /<input[^>]*required/.test(html1))

const html2 = renderToStaticMarkup(
  React.createElement(FormField, { label: '메모', type: 'text', required: false, value: '', onChange: () => {} })
)
check('text 필드 required=false → required 속성 없음', !/<input[^>]*required/.test(html2))

const html3 = renderToStaticMarkup(
  React.createElement(FormField, { label: '본문', type: 'textarea', required: true, value: '', onChange: () => {} })
)
check('textarea 필드 required=true → <textarea ... required> 실제로 생성됨', /<textarea[^>]*required/.test(html3))

const html4 = renderToStaticMarkup(
  React.createElement(FormField, { label: '링크', type: 'text', error: true, value: '', onChange: () => {} })
)
check('error=true → stamp-reject 테두리 클래스가 실제로 포함됨', html4.includes('border-stamp-reject'))

const html5 = renderToStaticMarkup(
  React.createElement(FormField, {
    label: '스크린샷 첨부 완료',
    type: 'checkbox',
    disabled: true,
    value: false,
    onChange: () => {},
  })
)
check('checkbox disabled=true → 실제 <input disabled> 생성됨 (4단계 게이팅 재확인)', /<input[^>]*disabled/.test(html5))

rmSync(tmpDir, { recursive: true, force: true })

console.log(`\n총 ${passed}개 테스트 통과`)
