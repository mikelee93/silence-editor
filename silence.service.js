const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');

// ── Writable Uploads Directory (Electron asar 호환 보장) ──
// asar 아카이브는 읽기 전용이므로 OS 임시 디렉토리에 생성
const UPLOAD_DIR = path.join(os.tmpdir(), 'silence_editor_uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ── FFmpeg 바이너리 경로 탐색 (Windows / macOS Intel & M시리즈 완벽 지원) ──
function resolveFfmpegPath() {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const isArm = process.arch === 'arm64';
    const exeName = isWin ? 'ffmpeg.exe' : 'ffmpeg';
    const candidates = [];

    // 1. Electron 패키징 extraResources / app 경로
    if (process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, 'bin', exeName));
        candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', exeName));
        if (isMac) {
            candidates.push(path.join(process.resourcesPath, 'app', 'node_modules', '@ffmpeg-installer', isArm ? 'darwin-arm64' : 'darwin-x64', 'ffmpeg'));
            candidates.push(path.join(process.resourcesPath, 'node_modules', '@ffmpeg-installer', isArm ? 'darwin-arm64' : 'darwin-x64', 'ffmpeg'));
        }
        if (isWin) {
            candidates.push(path.join(process.resourcesPath, 'app', 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe'));
            candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe'));
        }
    }

    // 2. 프로젝트 로컬 node_modules
    if (isMac) {
        candidates.push(path.join(__dirname, 'node_modules', '@ffmpeg-installer', isArm ? 'darwin-arm64' : 'darwin-x64', 'ffmpeg'));
        candidates.push(path.join(__dirname, '..', 'node_modules', '@ffmpeg-installer', isArm ? 'darwin-arm64' : 'darwin-x64', 'ffmpeg'));
        // Mac 시스템 설치 경로 (Homebrew 등)
        candidates.push('/opt/homebrew/bin/ffmpeg');
        candidates.push('/usr/local/bin/ffmpeg');
        candidates.push('/usr/bin/ffmpeg');
    }
    if (isWin) {
        candidates.push(path.join(__dirname, 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe'));
        candidates.push(path.join(__dirname, 'bin', 'ffmpeg.exe'));
        candidates.push(path.join(__dirname, '..', 'bin', 'ffmpeg.exe'));
    }

    // 3. node_modules @ffmpeg-installer 기본 탐색
    try {
        const installerPath = require('@ffmpeg-installer/ffmpeg').path;
        if (installerPath) candidates.push(installerPath);
    } catch (e) {}

    for (const cand of candidates) {
        if (cand && fs.existsSync(cand)) {
            // Mac/Linux의 경우 실행 권한 보장 (chmod 755)
            if (!isWin) {
                try { fs.chmodSync(cand, 0o755); } catch (e) {}
            }
            console.log('[FFmpeg Path Resolved]', cand);
            return cand;
        }
    }

    console.warn('[FFmpeg Path Fallback] Using system ffmpeg');
    return 'ffmpeg';
}

ffmpeg.setFfmpegPath(resolveFfmpegPath());

/**
 * Get Audio Metadata using ffprobe/ffmpeg
 */
function getAudioMetadata(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                // ffprobe 실패 시 fallback 기본 메타
                const stats = fs.statSync(filePath);
                return resolve({
                    duration: 0,
                    size: stats.size,
                    sampleRate: 44100,
                    channels: 2,
                    codec: 'audio'
                });
            }
            const stream = (metadata.streams || []).find(s => s.codec_type === 'audio') || (metadata.streams || [])[0] || {};
            const format = metadata.format || {};
            resolve({
                duration: parseFloat(format.duration || stream.duration || 0),
                size: parseInt(format.size || 0, 10),
                sampleRate: parseInt(stream.sample_rate || 44100, 10),
                channels: parseInt(stream.channels || 2, 10),
                codec: stream.codec_name || 'unknown'
            });
        });
    });
}

/**
 * Detect Silence using FFmpeg silencedetect filter
 * @param {string} filePath 
 * @param {number} noiseDb Noise threshold in dB (e.g. -38)
 * @param {number} minDuration Minimum silence duration in seconds (e.g. 0.35)
 */
function detectSilence(filePath, noiseDb = -38, minDuration = 0.35) {
    return new Promise((resolve, reject) => {
        const silences = [];
        let currentStart = null;

        ffmpeg(filePath)
            .audioFilters(`silencedetect=noise=${noiseDb}dB:d=${minDuration}`)
            .format('null')
            .on('stderr', (stderrLine) => {
                const startMatch = stderrLine.match(/silence_start:\s*([\d.]+)/);
                if (startMatch) {
                    currentStart = parseFloat(startMatch[1]);
                }
                const endMatch = stderrLine.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
                if (endMatch && currentStart !== null) {
                    const end = parseFloat(endMatch[1]);
                    const duration = parseFloat(endMatch[2]);
                    silences.push({
                        id: `silence_${silences.length + 1}`,
                        start: currentStart,
                        end: end,
                        duration: duration,
                        remove: true
                    });
                    currentStart = null;
                }
            })
            .on('end', () => {
                resolve(silences);
            })
            .on('error', (err) => {
                console.warn('[detectSilence FFmpeg warning]', err.message);
                resolve(silences); // 에러 시에도 빈 배열로 fallback
            })
            .save('/dev/null');
    });
}

/**
 * Remove silence intervals and apply playback speed, then produce trimmed audio file
 */
function processSilenceRemoval(inputPath, silences, totalDuration, speedRate = 1.0, exportFormat = 'wav') {
    return new Promise(async (resolve, reject) => {
        try {
            if (!totalDuration || totalDuration <= 0) {
                const meta = await getAudioMetadata(inputPath);
                totalDuration = meta.duration || 0;
            }

            const keptSegments = [];
            let lastPos = 0;

            const activeSilences = (silences || []).filter(s => s.remove).sort((a, b) => a.start - b.start);

            for (const s of activeSilences) {
                if (s.start > lastPos + 0.05) {
                    keptSegments.push({ start: lastPos, end: s.start });
                }
                lastPos = s.end;
            }

            if (totalDuration > lastPos + 0.05) {
                keptSegments.push({ start: lastPos, end: totalDuration });
            }

            if (keptSegments.length === 0) {
                keptSegments.push({ start: 0, end: Math.max(0.1, totalDuration) });
            }

            const ext = exportFormat === 'mp3' ? 'mp3' : 'wav';
            const outFilename = `result_trimmed_${Date.now()}.${ext}`;
            const outputPath = path.join(UPLOAD_DIR, outFilename);

            const filterParts = [];
            const concatInputs = [];

            keptSegments.forEach((seg, idx) => {
                filterParts.push(`[0:a]atrim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},asetpts=PTS-STARTPTS[a${idx}]`);
                concatInputs.push(`[a${idx}]`);
            });

            filterParts.push(`${concatInputs.join('')}concat=n=${keptSegments.length}:v=0:a=1[outa]`);

            let finalMap = 'outa';
            const speed = parseFloat(speedRate || 1.0);
            if (speed !== 1.0 && speed >= 0.5 && speed <= 2.0) {
                filterParts.push(`[outa]atempo=${speed.toFixed(2)}[outspeed]`);
                finalMap = 'outspeed';
            }

            const filterComplexStr = filterParts.join(';');

            let proc = ffmpeg(inputPath).complexFilter(filterComplexStr, [finalMap]);

            if (ext === 'mp3') {
                proc = proc.audioCodec('libmp3lame').audioBitrate('192k');
            } else {
                proc = proc.audioCodec('pcm_s16le');
            }

            proc.on('end', () => {
                resolve({
                    outputPath,
                    outFilename,
                    url: `/public/uploads/silence/${outFilename}`,
                    keptSegments,
                    speedRate: speed
                });
            })
            .on('error', (err) => {
                console.error('[processSilenceRemoval Error]', err);
                reject(err);
            })
            .save(outputPath);
        } catch (err) {
            console.error('[processSilenceRemoval try Error]', err);
            reject(err);
        }
    });
}

module.exports = {
    UPLOAD_DIR,
    getAudioMetadata,
    detectSilence,
    processSilenceRemoval
};
