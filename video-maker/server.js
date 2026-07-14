#!/usr/bin/env node
// video-maker 웹 UI — 터미널 없이 브라우저에서 씬을 구성하고 영상을 렌더링한다.
// build.js의 렌더링 로직은 그대로 재사용하고(자식 프로세스로 호출), 이 파일은
// 업로드 처리와 project.json 생성만 담당한다.

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const session = require('express-session');
const { OAuth2Client } = require('google-auth-library');

// 로컬 개발용 .env 로더 — Render 배포 환경은 대시보드에서 직접 환경변수를 설정하므로 불필요.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

const app = express();
const publicDir = path.join(__dirname, 'public');
const uploadTmp = path.join(os.tmpdir(), 'video-maker-uploads');
const jobsRoot = path.join(os.tmpdir(), 'video-maker-jobs');
fs.mkdirSync(uploadTmp, { recursive: true });
fs.mkdirSync(jobsRoot, { recursive: true });

const upload = multer({ dest: uploadTmp, limits: { fileSize: 200 * 1024 * 1024 } });

// 구글 로그인 — GOOGLE_CLIENT_ID 환경변수가 없으면 로그인 기능 자체를 건너뛴다
// (설정 전에도 도구가 그냥 동작하도록 하기 위함).
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const oauthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// Pexels 무료 스톡 사진 검색 — PEXELS_API_KEY 환경변수가 없으면 검색 기능만 비활성화된다.
const PEXELS_API_KEY = process.env.PEXELS_API_KEY || null;

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'video-maker-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

function requireAuthPage(req, res, next) {
  if (!GOOGLE_CLIENT_ID) return next(); // 로그인 미설정 시 그냥 통과
  if (req.session.user) return next();
  res.redirect('/login.html');
}

function requireAuthApi(req, res, next) {
  if (!GOOGLE_CLIENT_ID) return next();
  if (req.session.user) return next();
  res.status(401).json({ error: 'unauthorized' });
}

app.get('/api/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID, pexelsEnabled: Boolean(PEXELS_API_KEY) });
});

app.get('/api/pexels/search', requireAuthApi, async (req, res) => {
  if (!PEXELS_API_KEY) return res.status(400).json({ error: 'pexels_not_configured' });
  const query = String(req.query.q || '').trim();
  if (!query) return res.status(400).json({ error: 'missing_query' });
  const page = Math.max(1, Number(req.query.page) || 1);
  try {
    const upstream = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&page=${page}`,
      { headers: { Authorization: PEXELS_API_KEY } },
    );
    if (!upstream.ok) throw new Error(`pexels_status_${upstream.status}`);
    const data = await upstream.json();
    const photos = (data.photos || []).map((p) => ({
      id: p.id,
      thumb: p.src.medium,
      full: p.src.large2x || p.src.original,
      photographer: p.photographer,
    }));
    res.json({ photos });
  } catch (err) {
    res.status(502).json({ error: 'pexels_request_failed', detail: String(err.message || err) });
  }
});

// 클라이언트가 images.pexels.com에서 직접 fetch()하면 CORS로 막힐 수 있어 서버가 대신 받아 전달한다.
app.get('/api/pexels/image', requireAuthApi, async (req, res) => {
  const url = String(req.query.url || '');
  if (!/^https:\/\/images\.pexels\.com\//.test(url)) return res.status(400).json({ error: 'invalid_url' });
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) throw new Error(`fetch_status_${upstream.status}`);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    res.status(502).json({ error: 'pexels_image_failed', detail: String(err.message || err) });
  }
});

app.post('/api/auth/google', async (req, res) => {
  if (!oauthClient) return res.status(400).json({ error: 'google_login_not_configured' });
  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken: req.body.credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    req.session.user = { email: payload.email, name: payload.name, picture: payload.picture };
    res.json({ ok: true, user: req.session.user });
  } catch (err) {
    res.status(401).json({ error: 'invalid_token', detail: String(err.message || err) });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

app.get('/', requireAuthPage, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});
app.use(express.static(publicDir, { index: false }));
app.use('/jobs', requireAuthApi, express.static(jobsRoot));

app.post('/api/render', requireAuthApi, upload.any(), (req, res) => {
  let jobDir;
  try {
    const jobId = crypto.randomUUID();
    jobDir = path.join(jobsRoot, jobId);
    fs.mkdirSync(path.join(jobDir, 'assets'), { recursive: true });

    const fileMap = {};
    (req.files || []).forEach((f) => { fileMap[f.fieldname] = f; });

    const scenesMeta = JSON.parse(req.body.scenesMeta || '[]');
    if (!scenesMeta.length) throw new Error('씬이 하나도 없습니다.');

    const scenes = scenesMeta.map((s, i) => {
      const file = fileMap[`scene_image_${i}`];
      if (!file) throw new Error(`씬 ${i + 1}의 이미지 파일이 없습니다.`);
      const destName = `scene_${i}${path.extname(file.originalname) || '.png'}`;
      fs.copyFileSync(file.path, path.join(jobDir, 'assets', destName));
      const scene = {
        type: 'image',
        src: `assets/${destName}`,
        duration: Number(s.duration) || 4,
        motion: s.motion || 'zoom-in',
      };
      if (s.text) scene.text = s.text;

      const voiceFile = fileMap[`scene_voice_${i}`];
      if (voiceFile) {
        const voiceDestName = `voice_${i}${path.extname(voiceFile.originalname) || '.mp3'}`;
        fs.copyFileSync(voiceFile.path, path.join(jobDir, 'assets', voiceDestName));
        scene.voice = `assets/${voiceDestName}`;
        if (s.voiceVolume) scene.voiceVolume = Number(s.voiceVolume);
      }
      return scene;
    });

    let audioRel;
    if (fileMap.audio) {
      const audioFile = fileMap.audio;
      const destName = `audio${path.extname(audioFile.originalname) || '.mp3'}`;
      fs.copyFileSync(audioFile.path, path.join(jobDir, 'assets', destName));
      audioRel = `assets/${destName}`;
    }

    const cfg = {
      output: 'output.mp4',
      width: Number(req.body.width) || 1080,
      height: Number(req.body.height) || 1920,
      fps: Number(req.body.fps) || 30,
      transitionDuration: req.body.transitionDuration !== undefined ? Number(req.body.transitionDuration) : 0.6,
      scenes,
    };
    if (audioRel) {
      cfg.audio = audioRel;
      cfg.audioVolume = Number(req.body.audioVolume) || 1;
    }

    const projectPath = path.join(jobDir, 'project.json');
    fs.writeFileSync(projectPath, JSON.stringify(cfg, null, 2));

    const child = spawn('node', [path.join(__dirname, 'build.js'), projectPath]);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      cleanupUploads(req.files);
      res.status(500).json({ error: 'spawn_failed', detail: String(err.message || err) });
    });
    child.on('close', (code) => {
      cleanupUploads(req.files);
      if (code !== 0) {
        res.status(500).json({ error: 'render_failed', detail: stderr.slice(-4000) });
        return;
      }
      res.json({ videoUrl: `/jobs/${jobId}/output.mp4` });
    });
  } catch (err) {
    cleanupUploads(req.files);
    res.status(400).json({ error: 'bad_request', detail: String(err.message || err) });
  }
});

function cleanupUploads(files) {
  (files || []).forEach((f) => fs.unlink(f.path, () => {}));
}

const PORT = process.env.PORT || 4173;
app.listen(PORT, () => {
  console.log(`[video-maker] 웹 UI 실행 중: http://localhost:${PORT}`);
});
