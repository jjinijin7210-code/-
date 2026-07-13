# 애니원(AnyOne) 프로젝트

이 레포에는 두 개의 독립된 도구가 있습니다.

## [`anyone-dashboard/`](./anyone-dashboard)
애니원 AI 직원팀 운영 대시보드 (React + Vite + Tailwind, Express 백엔드).
직원 현황, Luna Creative Studio 조직도, 콘텐츠 관리, QA 파이프라인, 루나 요청,
June 캐릭터 관리, 브랜드 센터 등을 포함한 메인 대시보드입니다.
사용법은 `anyone-dashboard/README.md` 참고.

## [`video-maker/`](./video-maker)
정지 이미지(줌/팬 효과) + 씬별 보이스/배경음악을 조립해 mp4로 렌더링하는 도구.
웹 UI(`server.js`)와 CLI(`build.js`) 둘 다 지원합니다.
사용법은 `video-maker/README.md` 참고.
