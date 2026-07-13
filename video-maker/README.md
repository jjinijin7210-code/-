# video-maker

정지 이미지(줌/팬 효과) + 미리 만든 AI 영상 클립을 이어붙여, 배경음악과 씬별
보이스/내레이션까지 얹어서 하나의 mp4로 렌더링하는 도구입니다. 렌더링 로직(`build.js`)은
외부 npm 패키지 없이 시스템 `ffmpeg`만 사용합니다.

터미널 없이 쓰고 싶다면 브라우저 웹 UI(`server.js`)도 있습니다 — 씬마다 이미지·자막·
보이스를 직접 골라서 업로드하고 버튼 하나로 렌더링합니다.

## 요구 사항
- `ffmpeg`, `ffprobe` (Ubuntu: `apt-get install ffmpeg`)
- 한글 자막을 쓰려면 CJK 폰트 필요 (Ubuntu: `apt-get install fonts-noto-cjk`)
- Node.js 18+

## 웹 UI로 쓰기 (터미널 없이)
```bash
cd video-maker
npm install
node server.js
```
브라우저에서 http://localhost:4173 접속. 씬마다 이미지 업로드, 효과 선택, 자막 입력,
보이스/내레이션 파일을 직접 골라서 넣고 "영상 만들기"를 누르면 렌더링 후 바로
미리보기·다운로드할 수 있습니다.

## 구글 로그인 설정 (선택)
웹 UI에 "구글 계정으로 로그인"을 켜려면 환경변수 하나만 설정하면 됩니다.

- `GOOGLE_CLIENT_ID` — Google Cloud Console → APIs & Services → Credentials 에서
  만든 **OAuth 2.0 클라이언트 ID** 값 (`...apps.googleusercontent.com`). 클라이언트
  보안 비밀(secret)은 필요 없습니다 — 로그인 버튼이 브라우저에서 바로 인증하고
  서버는 결과만 검증하는 방식이라서요.
- 이 값을 설정하지 않으면 로그인 기능 자체가 꺼지고 누구나 바로 씁니다 (기본값).
- Google Cloud Console에서 해당 OAuth 클라이언트의 **"승인된 자바스크립트 원본"**에
  실제 접속 주소를 추가해야 로그인 버튼이 동작합니다 — 로컬 테스트용
  `http://localhost:4173`, 배포 후엔 Render에서 받은 주소(예:
  `https://video-maker-xxxx.onrender.com`) 둘 다 추가해두면 됩니다.
- 로컬에서 테스트할 땐: `GOOGLE_CLIENT_ID=여기에값 node server.js`
- Render에 배포할 땐: 대시보드의 Environment 탭에서 `GOOGLE_CLIENT_ID` 추가

## 설치 (CLI 커맨드로 등록)
```bash
cd video-maker
npm link
```
이후 이 환경 어디서든 `video-maker` 커맨드를 바로 쓸 수 있습니다. (상용 배포 시에는
`npm link` 대신 `npm publish`로 패키지를 배포하거나, `npm install -g` 로 설치하게 하면 됩니다.)

## 사용법
```bash
video-maker example/project.json
# 또는 링크 없이 바로:
node build.js example/project.json
```

## project.json 스키마
```jsonc
{
  "output": "output.mp4",       // 결과 파일 경로 (project.json 기준 상대경로 가능)
  "width": 1080,                 // 기본 1920
  "height": 1920,                // 기본 1080
  "fps": 30,                     // 기본 30
  "transitionDuration": 0.6,     // 씬 사이 크로스페이드 길이(초)
  "audio": "assets/song.mp3",    // 선택. 배경음악 (전체 타임라인에 깔림)
  "audioVolume": 0.8,            // 선택. 기본 1.0
  "loopAudio": true,             // 선택. 영상이 더 길면 오디오 반복
  "defaultSceneDuration": 4,     // 선택. scene.duration 생략 시 기본값
  "scenes": [
    {
      "type": "image",           // 정지 이미지 + 팬/줌 효과
      "src": "assets/scene1.png",
      "duration": 4,
      "motion": "zoom-in",       // zoom-in | zoom-out | pan-left | pan-right | none
      "text": "자막/가사 한 줄",  // 선택
      "voice": "assets/voice1.mp3", // 선택. 이 씬이 시작되는 시점에 맞춰 자동 재생
      "voiceVolume": 1.0            // 선택. 기본 1.0
    },
    {
      "type": "video",           // 미리 만든 영상 클립을 그대로 사용
      "src": "assets/ai_clip1.mp4",
      "duration": 5,              // 선택. 생략하면 클립 전체 길이 사용
      "text": "선택적 자막"
    }
  ]
}
```

## 여러 음성(보이스) 넣기
배경음악과는 별개로, 씬마다 서로 다른 보이스/내레이션 파일을 골라서 넣을 수 있습니다.
- 각 씬의 `voice`에 지정한 오디오는 그 씬이 화면에 나오기 시작하는 정확한 시점에
  맞춰 자동으로 딜레이되어 재생됩니다.
- 배경음악(`audio`)은 전체 길이에 깔리고, 씬별 보이스는 그 위에 믹싱됩니다.
- 웹 UI에서는 씬 카드마다 "보이스/내레이션" 파일 선택창이 있어서, 씬마다 원하는
  음성 파일을 직접 골라 업로드하면 됩니다 (사람마다 다른 목소리, 효과음 등도 가능).

## AI 영상 생성 연동 지점
이 도구 자체는 AI로 "움직이는" 영상을 새로 만들지 않습니다 (그건 Kling/Seedance 같은
모델의 영역이고, 학습된 모델이 필요해서 코드로 새로 만들 수 있는 범위가 아닙니다).

대신 `scene.type: "video"` 자리에 실제 AI가 생성한 클립 파일을 넣으면 정지 이미지
대신 그 영상이 타임라인에 그대로 들어갑니다. 즉:

1. Higgsfield 등에서 영상 클립을 생성 (유료 플랜 필요 — 현재 계정은 무료 플랜이라
   영상 생성 자체가 막혀 있음, 이미지 생성은 가능)
2. 생성된 mp4를 다운로드해서 `assets/` 폴더에 저장
3. project.json에서 해당 씬을 `"type": "video", "src": "assets/그파일.mp4"` 로 지정
4. 나머지 씬(정지 이미지)과 자유롭게 섞어서 `node build.js`로 한 번에 렌더링

크레딧/플랜이 없을 때는 모든 씬을 `type: "image"`로 두면 됩니다 — 화질은 원본
이미지 해상도를 그대로 따라가므로, 고해상도 이미지를 넣으면 AI 영상 모델의 유료
등급 제한 없이 4K 이상 출력도 가능합니다.

## 예제
`example/` 폴더에 샘플 프로젝트가 있습니다:
```bash
cd video-maker
node build.js example/project.json
```
`example/assets/`의 색상 배경 이미지 3장 + 사인파 오디오로 줌인 → 팬 → 줌아웃,
크로스페이드 전환, 한글 자막이 들어간 10.8초 mp4를 만듭니다.
