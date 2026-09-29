/**
 * ✂️ 무음 제거 에디터 - 독립형 Express 서버
 * Port: 4009
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const silenceService = require('./silence.service');

const app = express();
const PORT = 4009;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일 제공
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads/silence', express.static(silenceService.UPLOAD_DIR));
app.use('/public/uploads/silence', express.static(silenceService.UPLOAD_DIR));

// ── 헬스 체크 ──
app.get('/health', (req, res) => res.json({ ok: true, uploadDir: silenceService.UPLOAD_DIR }));

// ── 업로드 스토리지 설정 ──
const silenceStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, silenceService.UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `audio_${Date.now()}_${path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')}`)
});
const uploadSilence = multer({ storage: silenceStorage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB

// ── 1. POST /api/silence/detect ──
app.post('/api/silence/detect', uploadSilence.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: '업로드된 파일이 없습니다.' });
        }
        const noiseDb = parseFloat(req.body.noiseDb || -38);
        const minDuration = parseFloat(req.body.minDuration || 0.35);

        const metadata = await silenceService.getAudioMetadata(req.file.path);
        const silences = await silenceService.detectSilence(req.file.path, noiseDb, minDuration);
        const totalSilenceDuration = silences.reduce((acc, cur) => acc + cur.duration, 0);

        res.json({
            success: true,
            filePath: req.file.path,
            filename: req.file.filename,
            fileUrl: `/uploads/silence/${req.file.filename}`,
            originalName: req.file.originalname,
            size: req.file.size,
            metadata: metadata,
            silences: silences,
            detectedCount: silences.length,
            totalSilenceDuration: totalSilenceDuration
        });
    } catch (error) {
        console.error('[Silence Detect Error]', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── 2. POST /api/silence/apply ──
app.post('/api/silence/apply', async (req, res) => {
    try {
        let { filePath, filename, silences, totalDuration, speedRate, exportFormat } = req.body;
        
        // filename만 온 경우 절대경로 자동 보정
        if (!filePath && filename) {
            filePath = path.join(silenceService.UPLOAD_DIR, filename);
        }

        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(400).json({ success: false, error: '유효한 오디오 파일 경로가 아닙니다: ' + filePath });
        }

        const speed = parseFloat(speedRate || 1.0);
        const format = (exportFormat || 'wav').toLowerCase();

        const result = await silenceService.processSilenceRemoval(filePath, silences || [], parseFloat(totalDuration || 0), speed, format);
        const resultMetadata = await silenceService.getAudioMetadata(result.outputPath);

        const removedDuration = (silences || []).filter(s => s.remove).reduce((acc, cur) => acc + cur.duration, 0);
        const savedPercent = totalDuration > 0 ? ((removedDuration / totalDuration) * 100).toFixed(2) : '0.00';

        res.json({
            success: true,
            resultUrl: result.url,
            resultFilename: result.outFilename,
            resultMetadata: resultMetadata,
            removedDuration: removedDuration,
            savedPercent: savedPercent,
            speedRate: speed,
            exportFormat: format
        });
    } catch (error) {
        console.error('[Silence Apply Error]', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── 3. GET /api/silence/download/:filename ──
app.get('/api/silence/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(silenceService.UPLOAD_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('파일을 찾을 수 없습니다.');
    }
    res.download(filePath, `무음제거_결과_${filename}`);
});

// ── 4. GET /api/silence/audio-stream/:filename ──
app.get('/api/silence/audio-stream/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(silenceService.UPLOAD_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('파일을 찾을 수 없습니다.');
    }
    const stat = fs.statSync(filePath);
    const ext = path.extname(filename).toLowerCase();
    let mimeType = 'audio/wav';
    if (ext === '.mp3') mimeType = 'audio/mpeg';
    else if (ext === '.aac') mimeType = 'audio/aac';
    else if (ext === '.flac') mimeType = 'audio/flac';
    else if (ext === '.m4a') mimeType = 'audio/mp4';

    res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
});

// 서버 바인딩
const server = app.listen(PORT, () => {
    console.log(`✂️ 무음 제거 에디터 서버 실행 중 → http://localhost:${PORT}`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`[Server] 포트 ${PORT} 이미 실행 중 - 활성 서버를 사용합니다.`);
    } else {
        console.error('[Server Error]', err);
    }
});

module.exports = app;
