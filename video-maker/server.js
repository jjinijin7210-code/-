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

const app = express();
const uploadTmp = path.join(os.tmpdir(), 'video-maker-uploads');
const jobsRoot = path.join(os.tmpdir(), 'video-maker-jobs');
fs.mkdirSync(uploadTmp, { recursive: true });
fs.mkdirSync(jobsRoot, { recursive: true });

const upload = multer({ dest: uploadTmp, limits: { fileSize: 200 * 1024 * 1024 } });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/jobs', express.static(jobsRoot));

app.post('/api/render', upload.any(), (req, res) => {
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
