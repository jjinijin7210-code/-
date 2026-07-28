// 영상 제작실 Remotion 베타 렌더링용 최소 설정.
// npx remotion studio / remotion render 같은 CLI에서만 읽힘 - server/lib/remotionRenderer.js가
// bundle()/renderMedia()를 직접 호출할 때는 이 파일과 무관하게 동작함.
import { Config } from '@remotion/cli/config'

Config.setVideoImageFormat('jpeg')
