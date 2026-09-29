/**
 * ✂️ 무음 제거 & 배속 조절 에디터 (Silence Remover & Speed Changer) Controller
 * Direct Web Audio API Player Engine (HTML5 Media Error 100% Immune)
 */
(function() {
    // ── API 기본 주소 (Electron file:// 및 브라우저 http:// 동시 지원) ──
    const API_BASE = window.location.protocol.startsWith('http') ? '' : 'http://localhost:4009';

    // ── 상태 ─────────────────────────────────────────────────────────
    window.silenceState = {
        file: null,
        fileData: null,          // /api/silence/detect 결과
        resultData: null,        // /api/silence/apply 결과
        preset: 'talk',
        activeTab: 'original',   // 'original' | 'result'
        audioBuffer: null,       // Web Audio DecodeBuffer (원본)
        resultAudioBuffer: null, // Web Audio DecodeBuffer (결과)
        resultDuration: 0,       // 결과 오디오의 초 단위 길이
        silences: [],            // [{ id, start, end, duration, remove }]
        speedRate: 1.0,          // 0.5 ~ 2.0배속
        exportFormat: 'wav',     // 'wav' | 'mp3'
        zoom: 1,

        // 🎵 Pitch-Preserved HTML5 Audio Player Engine (preservesPitch = true)
        audioElem: null,
        originalObjectUrl: null, // 원본 Blob URL
        resultAudioUrl: null,    // 결과 Audio URL
        isPlaying: false,
        pauseOffset: 0           // 오디오 내 트랙 재생 위치 (초 단위)
    };

    let playheadAnimFrame = null;

    // 상단(플레이어바) 및 하단(액션바) 저장 버튼 일괄 상태 관리
    function setDownloadButtonsState(disabled, text) {
        const btnBottom = document.getElementById('btnSilenceDownload');
        const btnTop = document.getElementById('btnSilenceDownloadTop');
        if (btnBottom) {
            btnBottom.disabled = disabled;
            if (text) btnBottom.innerHTML = `<span>💾 ${text}</span>`;
        }
        if (btnTop) {
            btnTop.disabled = disabled;
            if (text) btnTop.textContent = text;
        }
    }

    // Pitch Preservation 기능이 켜진 HTMLAudioElement 취득
    function getAudioElem() {
        if (!window.silenceState.audioElem) {
            const audio = new Audio();
            audio.preservesPitch = true;
            if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = true;
            if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;
            window.silenceState.audioElem = audio;
        }
        const audio = window.silenceState.audioElem;
        audio.preservesPitch = true;
        if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = true;
        if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;
        return audio;
    }

    // AudioContext 싱글톤 (파형 디코딩 전용)
    function getAudioCtx() {
        if (!window.silenceState.audioCtx) {
            window.silenceState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (window.silenceState.audioCtx.state === 'suspended') {
            window.silenceState.audioCtx.resume();
        }
        return window.silenceState.audioCtx;
    }

    // 현재 탭에 맞는 오디오 재생 URL 취득
    function getCurrentAudioUrl() {
        if (window.silenceState.activeTab === 'original') {
            return window.silenceState.originalObjectUrl;
        }
        return window.silenceState.resultAudioUrl || null;
    }

    // 현재 탭에 맞는 디코딩된 AudioBuffer 취득 (파형 시각화용)
    function getCurrentBuffer() {
        if (window.silenceState.activeTab === 'original') {
            return window.silenceState.audioBuffer;
        }
        return window.silenceState.resultAudioBuffer || null;
    }

    // 현재 트랙 총 길이 구하기
    function getCurrentDuration() {
        const audio = getAudioElem();
        if (audio && audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
            return audio.duration;
        }
        const buf = getCurrentBuffer();
        if (buf) return buf.duration;
        if (window.silenceState.activeTab === 'result' && window.silenceState.resultDuration) {
            return window.silenceState.resultDuration;
        }
        return 0;
    }

    // 현재 실시간 재생 트랙 위치 계산 (초 단위)
    function getCurrentPlaybackTime() {
        const audio = getAudioElem();
        if (audio && audio.src && !isNaN(audio.currentTime)) {
            return audio.currentTime;
        }
        return window.silenceState.pauseOffset || 0;
    }

    // ── 🎵 재생/일시정지 토글 (Pitch-Preserved Audio Engine - 목소리 톤 변형 0%) ──
    window.toggleSilenceAudioPlay = function() {
        if (window.silenceState.isPlaying) {
            pauseSilenceAudio();
        } else {
            playSilenceAudio(getCurrentPlaybackTime());
        }
    };

    window.playSilenceAudio = function(offset = 0) {
        const url = getCurrentAudioUrl();
        if (!url) {
            if (window.silenceState.activeTab === 'result') {
                alert('결과 오디오가 아직 처리되지 않았거나 준비 중입니다.');
            } else {
                alert('오디오 파일 업로드 완료 후 재생하실 수 있습니다.');
            }
            return;
        }

        const audio = getAudioElem();
        const tab = window.silenceState.activeTab;

        // 소스 바인딩
        if (audio.src !== url && audio.src !== window.location.origin + url) {
            audio.src = url;
        }

        // ⚡ 목소리 톤 변형 없는 피치 보존 (Pitch Preservation) 설정 및 실시간 배속 반영
        audio.preservesPitch = true;
        if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = true;
        if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;

        const speed = window.silenceState.speedRate || 1.0;
        audio.playbackRate = speed;

        if (!isNaN(offset) && Math.abs(audio.currentTime - offset) > 0.3) {
            try { audio.currentTime = offset; } catch (e) {}
        }

        audio.onended = () => {
            stopSilenceAudio();
        };

        audio.play().then(() => {
            window.silenceState.isPlaying = true;
            const btn = document.getElementById('btnSilencePlayPause');
            if (btn) btn.textContent = '❚❚';
            startPlayheadLoop();
        }).catch(err => {
            console.error('[Audio Play Error]', err);
        });
    };

    window.pauseSilenceAudio = function() {
        const audio = getAudioElem();
        if (audio) {
            audio.pause();
            window.silenceState.pauseOffset = audio.currentTime;
        }

        window.silenceState.isPlaying = false;

        const btn = document.getElementById('btnSilencePlayPause');
        if (btn) btn.textContent = '▶';

        stopPlayheadLoop();
    };

    window.stopSilenceAudio = function() {
        const audio = getAudioElem();
        if (audio) {
            audio.pause();
            try { audio.currentTime = 0; } catch (e) {}
            window.silenceState.pauseOffset = 0;
        }

        window.silenceState.isPlaying = false;

        const btn = document.getElementById('btnSilencePlayPause');
        if (btn) btn.textContent = '▶';

        stopPlayheadLoop();
    };

    // ── 60fps 애니메이션 프레임 루프 (Playhead & 타임코드) ─────────────
    function startPlayheadLoop() {
        cancelAnimationFrame(playheadAnimFrame);
        function loop() {
            drawSilenceWaveform();
            if (window.silenceState.isPlaying) {
                playheadAnimFrame = requestAnimationFrame(loop);
            }
        }
        playheadAnimFrame = requestAnimationFrame(loop);
    }

    function stopPlayheadLoop() {
        cancelAnimationFrame(playheadAnimFrame);
        drawSilenceWaveform();
    }

    function formatTimeWithTenths(sec) {
        if (!sec || isNaN(sec) || sec < 0) return '00:00.0';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        const tenths = Math.floor((sec % 1) * 10);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
    }

    // ── ⚡ 초고속 클라이언트단 무음 탐지기 (Web Audio API PCM Scan) ───
    function detectSilencesClientSide(buffer, noiseDb = -38, minDuration = 0.35) {
        if (!buffer) return [];

        const pcm = buffer.getChannelData(0);
        const sampleRate = buffer.sampleRate;
        const threshold = Math.pow(10, noiseDb / 20);
        const minSamples = Math.floor(minDuration * sampleRate);

        const silences = [];
        let silenceStart = null;

        for (let i = 0; i < pcm.length; i++) {
            const amp = Math.abs(pcm[i]);
            if (amp < threshold) {
                if (silenceStart === null) silenceStart = i;
            } else {
                if (silenceStart !== null) {
                    const silenceLength = i - silenceStart;
                    if (silenceLength >= minSamples) {
                        const startSec = silenceStart / sampleRate;
                        const endSec = i / sampleRate;
                        silences.push({
                            id: 'silence_' + Math.random().toString(36).substr(2, 7),
                            start: parseFloat(startSec.toFixed(3)),
                            end: parseFloat(endSec.toFixed(3)),
                            duration: parseFloat((endSec - startSec).toFixed(3)),
                            remove: true
                        });
                    }
                    silenceStart = null;
                }
            }
        }

        if (silenceStart !== null) {
            const silenceLength = pcm.length - silenceStart;
            if (silenceLength >= minSamples) {
                const startSec = silenceStart / sampleRate;
                const endSec = pcm.length / sampleRate;
                silences.push({
                    id: 'silence_' + Math.random().toString(36).substr(2, 7),
                    start: parseFloat(startSec.toFixed(3)),
                    end: parseFloat(endSec.toFixed(3)),
                    duration: parseFloat((endSec - startSec).toFixed(3)),
                    remove: true
                });
            }
        }

        return silences;
    }

    // ── 프리셋 설정 ──────────────────────────────────────────────────
    window.selectSilencePreset = function(preset) {
        window.silenceState.preset = preset;
        const presets = ['tight', 'talk', 'podcast', 'speed_only', 'custom'];
        presets.forEach(p => {
            const btn = document.getElementById(`silencePreset_${p}`);
            if (btn) btn.classList.toggle('active', p === preset);
        });

        const noiseDbInput = document.getElementById('silenceNoiseDb');
        const minDurInput = document.getElementById('silenceMinDuration');
        const dbLabel = document.getElementById('silenceValDbLabel');
        const durLabel = document.getElementById('silenceValDurationLabel');
        const desc = document.getElementById('silencePresetDesc');

        let db = -38, dur = 0.35, textDesc = '';

        if (preset === 'speed_only') {
            textDesc = '⚡ 무음 유지 · 순수 배속 조절 전용 모드';
            if (desc) desc.textContent = textDesc;

            // 모든 무음 구간 remove = false 로 일괄 변경 (무음 보존!)
            if (window.silenceState.silences) {
                window.silenceState.silences.forEach(s => s.remove = false);
            }
            updateSilenceMetricsUI();
            renderSilenceDetailList();
            drawSilenceWaveform();
            if (typeof showToast === 'function') showToast('⚡ 순수 배속 조절 전용 모드가 적용되었습니다. (무음 유지)');
            return;
        }

        if (preset === 'tight') {
            db = -26; dur = 0.15;
            textDesc = '숨소리 제거 · -26 dB · 최소 0.15s';
        } else if (preset === 'talk') {
            db = -30; dur = 0.25;
            textDesc = '대화 빠르게 · -30 dB · 최소 0.25s';
        } else if (preset === 'podcast') {
            db = -38; dur = 0.35;
            textDesc = '팟캐스트 · -38 dB · 최소 0.35s';
        } else {
            db = parseInt(noiseDbInput ? noiseDbInput.value : -38, 10);
            dur = parseFloat(minDurInput ? minDurInput.value : 0.35);
            textDesc = `사용자 정의 · ${db} dB · 최소 ${dur}s`;
        }

        if (preset !== 'custom') {
            if (noiseDbInput) noiseDbInput.value = db;
            if (minDurInput) minDurInput.value = dur;
            if (dbLabel) dbLabel.textContent = `${db} dB`;
            if (durLabel) durLabel.textContent = `${dur}s`;
        }

        if (desc) desc.textContent = textDesc;

        // 프리셋/슬라이더 변경 시 즉시 탐지 재계산
        if (window.silenceState.audioBuffer) {
            window.silenceState.silences = detectSilencesClientSide(window.silenceState.audioBuffer, db, dur);
            updateSilenceMetricsUI();
            renderSilenceDetailList();
            drawSilenceWaveform();
        }
    };

    // ── ⚡ 포맷 드롭다운 동기화 ──────────────────────────────────────
    window.syncSilenceExportFormat = function(fmt) {
        window.silenceState.exportFormat = fmt || 'wav';
        const selects = document.querySelectorAll('.silence-format-select');
        selects.forEach(sel => {
            if (sel.value !== fmt) sel.value = fmt;
        });
    };

    // ── ⚡ mp3cut.net 스타일 재생 바 일체형 배속 조절 제어 ─────────────
    window.updateSilenceSpeedRate = function(val) {
        const speed = parseFloat(val || 1.0);
        window.silenceState.speedRate = speed;

        // 양방향 슬라이더 100% 실시간 동기화
        const sliders = document.querySelectorAll('.silence-speed-slider');
        sliders.forEach(s => {
            if (parseFloat(s.value) !== speed) s.value = speed;
        });

        // 수치 뱃지 갱신
        const valElem = document.getElementById('silencePlayerSpeedVal');
        if (valElem) valElem.textContent = `${speed.toFixed(2)}x`;

        const badge = document.getElementById('silenceSpeedBadge');
        if (badge) {
            badge.textContent = `${speed.toFixed(2)}x ${speed === 1.0 ? '(원래 속도)' : ''}`;
        }

        // ⚡ 실시간 재생 중이면 HTMLAudioElement의 playbackRate 및 preservesPitch 즉시 반영! (목소리 피치 100% 보존)
        if (window.silenceState.isPlaying && window.silenceState.audioElem) {
            const audio = window.silenceState.audioElem;
            audio.preservesPitch = true;
            if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = true;
            if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;
            audio.playbackRate = speed;
        }

        updateSilenceMetricsUI();
    };

    window.setSilenceSpeedPreset = function(speed) {
        updateSilenceSpeedRate(speed);
    };

    // ── 파일 선택 (업로드 즉시 실시간 무음 자동 감지!) ─────────────
    window.onSilenceFileSelected = function(e) {
        const file = e.target.files[0];
        if (!file) return;

        stopSilenceAudio();

        if (window.silenceState.originalObjectUrl) {
            try { URL.revokeObjectURL(window.silenceState.originalObjectUrl); } catch (e) {}
        }
        window.silenceState.originalObjectUrl = URL.createObjectURL(file);

        window.silenceState.file = file;
        window.silenceState.fileData = null;
        window.silenceState.resultData = null;
        window.silenceState.resultAudioUrl = null;
        window.silenceState.audioBuffer = null;
        window.silenceState.resultAudioBuffer = null;
        window.silenceState.resultDuration = 0;
        window.silenceState.silences = [];
        window.silenceState.activeTab = 'original';

        const btnDetect = document.getElementById('btnSilenceDetect');
        const btnApply = document.getElementById('btnSilenceApply');

        if (btnDetect) btnDetect.disabled = false;
        if (btnApply) {
            btnApply.disabled = false;
            btnApply.innerHTML = `<span>⚡ 무음제거 / 배속 적용하기</span>`;
        }
        setDownloadButtonsState(true);

        // 메타 칩 표시
        const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
        document.getElementById('silenceChipName').textContent = file.name;
        document.getElementById('silenceChipSize').textContent = `${sizeMb} MB`;
        document.getElementById('silenceMetaChips').style.display = 'flex';

        // 탭 UI 원본으로 리셋
        window.switchSilenceWaveTab('original');

        // Web Audio API로 원본 파형 디코딩 + 🚀 즉시 0.01초 만에 무음 자동 감지!
        decodeAndAutoDetectSilence(file);
    };

    async function decodeAndAutoDetectSilence(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const ctx = getAudioCtx();
            const decodedData = await ctx.decodeAudioData(arrayBuffer);
            window.silenceState.audioBuffer = decodedData;

            // 메타 칩 보강
            const dur = decodedData.duration.toFixed(3);
            const sr = decodedData.sampleRate.toLocaleString();
            const ch = decodedData.numberOfChannels;

            document.getElementById('silenceChipDuration').textContent = `${dur}초`;
            document.getElementById('silenceChipSampleRate').textContent = `${sr}Hz`;
            document.getElementById('silenceChipChannels').textContent = `${ch}ch`;

            // 🚀 파일 넣자마자 0.01초 만에 무음 구간 실시간 탐지!
            const noiseDb = parseInt(document.getElementById('silenceNoiseDb')?.value || -38, 10);
            const minDur = parseFloat(document.getElementById('silenceMinDuration')?.value || 0.35);

            window.silenceState.silences = detectSilencesClientSide(decodedData, noiseDb, minDur);

            // UI 및 파형 즉시 하이라이트 갱신!
            updateSilenceMetricsUI();
            renderSilenceDetailList();
            drawSilenceWaveform();

            document.getElementById('silenceNoticeBanner').style.display = 'flex';
            document.getElementById('silenceNoticeText').textContent = `🎉 파일 로드 완료! 무음 ${window.silenceState.silences.length}개가 실시간 탐지되었습니다. [적용하기]를 누르거나 속도를 조절하세요.`;

            // 백그라운드 서버 파이프라인 동기화
            runSilenceDetectionSilent();
        } catch (err) {
            console.warn('[decodeAndAutoDetectSilence error, fallback to server detect]', err);
            const detectData = await runSilenceDetectionSilent();
            if (detectData && detectData.metadata) {
                document.getElementById('silenceChipDuration').textContent = `${(detectData.metadata.duration || 0).toFixed(2)}초`;
                document.getElementById('silenceChipSampleRate').textContent = `${detectData.metadata.sampleRate || 44100}Hz`;
                document.getElementById('silenceChipChannels').textContent = `${detectData.metadata.channels || 2}ch`;
                window.silenceState.silences = detectData.silences || [];
                updateSilenceMetricsUI();
                renderSilenceDetailList();
                drawSilenceWaveform();
                document.getElementById('silenceNoticeBanner').style.display = 'flex';
                document.getElementById('silenceNoticeText').textContent = `🎉 파일 로드 완료! 무음 ${window.silenceState.silences.length}개가 감지되었습니다. [적용하기]를 누르세요.`;
            }
        }
    }

    // 백그라운드 조용히 서버 FFmpeg 감지 동기화
    async function runSilenceDetectionSilent() {
        const file = window.silenceState.file;
        if (!file) return null;
        try {
            const noiseDb = document.getElementById('silenceNoiseDb')?.value || -38;
            const minDuration = document.getElementById('silenceMinDuration')?.value || 0.35;

            const formData = new FormData();
            formData.append('file', file);
            formData.append('noiseDb', noiseDb);
            formData.append('minDuration', minDuration);

            const response = await fetch(`${API_BASE}/api/silence/detect`, { method: 'POST', body: formData });
            const json = await response.json();
            if (json.success) {
                window.silenceState.fileData = json;
                return json;
            }
        } catch (e) {
            console.warn('[runSilenceDetectionSilent error]', e);
        }
        return null;
    }

    // 수동 [무음 구간 감지하기] 버튼 클릭
    window.runSilenceDetection = async function() {
        const file = window.silenceState.file;
        if (!file) {
            alert('먼저 오디오/영상 파일을 업로드해주세요.');
            return;
        }

        const noiseDb = document.getElementById('silenceNoiseDb').value;
        const minDuration = document.getElementById('silenceMinDuration').value;

        const btnDetect = document.getElementById('btnSilenceDetect');
        if (btnDetect) {
            btnDetect.disabled = true;
            btnDetect.innerHTML = `<span>⏳ 무음 구간 감지 중...</span>`;
        }

        try {
            if (window.silenceState.audioBuffer) {
                window.silenceState.silences = detectSilencesClientSide(window.silenceState.audioBuffer, noiseDb, minDuration);
                updateSilenceMetricsUI();
                renderSilenceDetailList();
                drawSilenceWaveform();
            }

            await runSilenceDetectionSilent();

            document.getElementById('btnSilenceApply').disabled = false;
            document.getElementById('silenceNoticeBanner').style.display = 'flex';
            document.getElementById('silenceNoticeText').textContent = `무음 ${window.silenceState.silences.length}개가 감지되었습니다. [적용하기]를 눌러 결과를 생성하세요.`;

            if (typeof showToast === 'function') showToast(`🎉 무음 ${window.silenceState.silences.length}개 감지 완료!`);

        } catch (err) {
            console.error(err);
            alert('무음 감지 오류: ' + err.message);
        } finally {
            if (btnDetect) {
                btnDetect.disabled = false;
                btnDetect.innerHTML = `<span>🔍 무음 구간 감지하기</span>`;
            }
        }
    };

    // ── 무음 제거 또는 배속 조절 적용하기 (100% 오디오 미리듣기 보장) ────
    window.runSilenceApply = async function() {
        const file = window.silenceState.file;
        if (!file && (!window.silenceState.fileData || !window.silenceState.fileData.filePath)) {
            alert('오디오/영상 파일을 먼저 업로드해주세요.');
            return;
        }

        stopSilenceAudio();

        const btnApply = document.getElementById('btnSilenceApply');
        if (btnApply) {
            btnApply.disabled = true;
            btnApply.innerHTML = `<span>⏳ 인코딩 및 처리 중...</span>`;
        }

        try {
            let filePath = window.silenceState.fileData ? window.silenceState.fileData.filePath : null;
            let totalDuration = window.silenceState.fileData ? window.silenceState.fileData.metadata.duration : (window.silenceState.audioBuffer ? window.silenceState.audioBuffer.duration : 0);

            if (!filePath && file) {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('noiseDb', '-60');
                formData.append('minDuration', '10.0');

                const detectRes = await fetch(`${API_BASE}/api/silence/detect`, { method: 'POST', body: formData });
                const detectJson = await detectRes.json();
                if (detectJson.success) {
                    window.silenceState.fileData = detectJson;
                    filePath = detectJson.filePath;
                    totalDuration = detectJson.metadata.duration;
                } else {
                    throw new Error('파일 업로드 실패: ' + detectJson.error);
                }
            }

            const speedRate = window.silenceState.speedRate || 1.0;
            const exportFormat = document.getElementById('silenceExportFormat')?.value || 'wav';

            const response = await fetch(`${API_BASE}/api/silence/apply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filePath: filePath,
                    filename: window.silenceState.fileData ? window.silenceState.fileData.filename : null,
                    silences: window.silenceState.silences || [],
                    totalDuration: totalDuration,
                    speedRate: speedRate,
                    exportFormat: exportFormat
                })
            });

            const json = await response.json();

            if (!json.success) {
                alert('처리 실패: ' + json.error);
                return;
            }

            window.silenceState.resultData = json;
            if (json.resultMetadata && json.resultMetadata.duration) {
                window.silenceState.resultDuration = json.resultMetadata.duration;
            } else {
                const removedDur = (window.silenceState.silences || []).filter(s => s.remove).reduce((a, b) => a + b.duration, 0);
                window.silenceState.resultDuration = Math.max(0.1, (totalDuration - removedDur) / speedRate);
            }

            // IDM 등 다운로드 프로그램의 확장자(.wav) 가로채기 방지를 위해 스트리밍 API 경로 사용
            const streamUrl = json.resultFilename ? `${API_BASE}/api/silence/audio-stream/${json.resultFilename}?t=${Date.now()}` : (`${API_BASE}${json.resultUrl}?t=${Date.now()}`);
            window.silenceState.resultAudioUrl = streamUrl;

            // 🚀 결과 오디오 파일 Web Audio AudioBuffer로 디코딩 (파형 시각화 전용)
            try {
                console.log('[Result Audio Fetch Stream URL]', streamUrl);
                const fetchRes = await fetch(streamUrl, {
                    headers: { 'X-Requested-With': 'XMLHttpRequest' }
                });
                if (fetchRes.ok) {
                    const arrBuf = await fetchRes.arrayBuffer();
                    console.log('[Result Audio Buffer Size]', arrBuf.byteLength, 'bytes');
                    if (arrBuf.byteLength >= 100) {
                        const ctx = getAudioCtx();
                        window.silenceState.resultAudioBuffer = await ctx.decodeAudioData(arrBuf);
                        console.log('[Result Audio Decoded OK] duration:', window.silenceState.resultAudioBuffer.duration, 's');
                    } else {
                        console.warn('[Result Audio Buffer Small / Intercepted by IDM]', arrBuf.byteLength);
                        window.silenceState.resultAudioBuffer = null;
                    }
                } else {
                    console.warn('[Result Audio Stream Fetch Status]', fetchRes.status);
                    window.silenceState.resultAudioBuffer = null;
                }
            } catch (bufErr) {
                console.warn('[Result Audio Decode Handled]', bufErr.message);
                window.silenceState.resultAudioBuffer = null;
            }

            // 🚀 결과 파형 탭으로 전환
            window.switchSilenceWaveTab('result');

            // 🚀 스피커로 오디오 즉시 빵빵하게 커스텀 Web Audio API 플레이어로 자동 재생!
            playSilenceAudio(0);

            setDownloadButtonsState(false, '저장');
            document.getElementById('silenceNoticeBanner').style.display = 'flex';
            document.getElementById('silenceNoticeText').textContent = `🎉 결과 생성이 완료되었습니다! 재생 바에서 들어보거나 [저장] 버튼을 누르세요.`;

            const speedMsg = speedRate !== 1.0 ? ` ${speedRate}x 배속` : '';
            const silenceMsg = (window.silenceState.silences || []).filter(s => s.remove).length > 0 ? ' 무음제거 &' : '';
            if (typeof showToast === 'function') showToast(`🎉${silenceMsg}${speedMsg} 처리가 완료되었습니다!`);

        } catch (err) {
            console.error(err);
            alert('적용 중 오류 발생: ' + err.message);
        } finally {
            if (btnApply) {
                btnApply.disabled = false;
                btnApply.innerHTML = `<span>⚡ 무음제거 / 배속 적용하기</span>`;
            }
        }
    };

    // ── 5개 KPI 메트릭 계산 및 갱신 ─────────────────────────────────────
    function updateSilenceMetricsUI() {
        const fileData = window.silenceState.fileData;
        const silences = window.silenceState.silences || [];
        const speed = window.silenceState.speedRate || 1.0;

        const totalDuration = fileData ? fileData.metadata.duration : (window.silenceState.audioBuffer ? window.silenceState.audioBuffer.duration : 0);
        const removedDuration = silences.filter(s => s.remove).reduce((acc, cur) => acc + cur.duration, 0);

        const netDuration = Math.max(0, totalDuration - removedDuration);
        const predictedFinalDuration = netDuration / speed;

        const savedPercent = totalDuration > 0 ? (((totalDuration - predictedFinalDuration) / totalDuration) * 100).toFixed(2) : '0.00';

        const elemRemoved = document.getElementById('silenceValRemovedDuration');
        const elemFinal = document.getElementById('silenceValFinalDuration');
        const elemSaved = document.getElementById('silenceValSavedPercent');

        if (elemRemoved) elemRemoved.textContent = `${removedDuration.toFixed(3)}초`;
        if (elemFinal) elemFinal.textContent = `${predictedFinalDuration.toFixed(3)}초`;
        if (elemSaved) elemSaved.textContent = `${savedPercent}%`;

        const totalBadge = document.getElementById('silenceTotalListCount');
        if (totalBadge) totalBadge.textContent = `감지 ${silences.length}개`;

        if (window.silenceState.activeTab === 'original') {
            const headerBadge = document.getElementById('silenceHeaderBadge');
            if (headerBadge) headerBadge.textContent = `감지 ${silences.length}개`;
        }
    }

    // ── 감지 세부 구간 목록 렌더링 ────────────────────────────────────
    function renderSilenceDetailList() {
        const container = document.getElementById('silenceDetailList');
        const silences = window.silenceState.silences || [];

        if (!container) return;

        if (silences.length === 0) {
            container.innerHTML = `<div style="font-size:11px; color:#64748b; text-align:center; padding:16px 0;">감지된 무음 구간이 없습니다.</div>`;
            return;
        }

        container.innerHTML = silences.map((s, idx) => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); padding:6px 12px; border-radius:6px; font-size:11px;">
                <div style="display:flex; gap:10px; align-items:center;">
                    <span style="font-weight:700; color:#64748b; width:24px;">#${idx + 1}</span>
                    <span style="color:#ffffff; font-family:monospace;">${s.start.toFixed(3)}s ~ ${s.end.toFixed(3)}s</span>
                    <span style="color:#facc15; font-weight:600;">(${s.duration.toFixed(3)}초)</span>
                </div>
                <label style="display:flex; align-items:center; gap:6px; font-size:11px; color:${s.remove ? '#ef4444' : '#22c55e'}; cursor:pointer; font-weight:700;">
                    <input type="checkbox" ${s.remove ? 'checked' : ''} onchange="toggleSilenceItem('${s.id}')">
                    <span>${s.remove ? '제거됨' : '유지됨'}</span>
                </label>
            </div>
        `).join('');
    }

    window.toggleSilenceItem = function(id) {
        const item = window.silenceState.silences.find(s => s.id === id);
        if (item) {
            item.remove = !item.remove;
            updateSilenceMetricsUI();
            renderSilenceDetailList();
            drawSilenceWaveform();
        }
    };

    // ── 탭 전환 (원본 파형 / 결과 파형) ──────────────────────────────
    window.switchSilenceWaveTab = function(tab) {
        stopSilenceAudio();

        window.silenceState.activeTab = tab;
        const btnOrig = document.getElementById('btnSilenceTabOrig');
        const btnRes = document.getElementById('btnSilenceTabResult');
        const headerTitle = document.getElementById('silenceHeaderTitle');
        const headerBadge = document.getElementById('silenceHeaderBadge');

        if (btnOrig) {
            btnOrig.style.background = tab === 'original' ? '#2563eb' : 'transparent';
            btnOrig.style.color = tab === 'original' ? '#fff' : '#94a3b8';
        }
        if (btnRes) {
            btnRes.style.background = tab === 'result' ? '#2563eb' : 'transparent';
            btnRes.style.color = tab === 'result' ? '#fff' : '#94a3b8';
        }

        if (tab === 'original') {
            if (headerTitle) headerTitle.textContent = 'Original Audio';
            if (headerBadge) headerBadge.textContent = `감지 ${(window.silenceState.silences || []).length}개`;
        } else {
            if (headerTitle) headerTitle.textContent = 'Result Audio (무음 제거 & 배속 적용 완료)';
            const dur = getCurrentDuration();
            if (headerBadge) headerBadge.textContent = `결과 ${parseFloat(dur).toFixed(3)}초`;
        }

        drawSilenceWaveform();
    };

    // ── 2D Canvas Waveform Visualizer & Moving Playhead Cursor ───────
    window.drawSilenceWaveform = function() {
        const canvas = document.getElementById('silenceWaveformCanvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width = canvas.parentElement.clientWidth || 1200;
        const height = canvas.height = 150;

        ctx.clearRect(0, 0, width, height);

        const tab = window.silenceState.activeTab;
        const buffer = getCurrentBuffer();

        const currTime = getCurrentPlaybackTime();
        const totalDuration = getCurrentDuration();

        // ⏱️ mp3cut.net 우측 상단 정밀 타임코드 갱신 (00:00.0 / 00:42.9)
        const playTimeElem = document.getElementById('silencePlayTime');
        if (playTimeElem) {
            playTimeElem.textContent = `${formatTimeWithTenths(currTime)} / ${formatTimeWithTenths(totalDuration)}`;
        }

        // Background Gradient (Dark Navy / Cyan Luxury Studio)
        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, '#082f49');
        grad.addColorStop(1, '#0c4a6e');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);

        // Center line
        const amp = height / 2;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, amp);
        ctx.lineTo(width, amp);
        ctx.stroke();

        // 만약 원본 버퍼가 없으면 안내 문구
        if (!window.silenceState.audioBuffer && !buffer) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '13px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(tab === 'original' ? '오디오 파일 열기 시 파형 및 무음 구간이 즉시 시각화됩니다.' : '적용하기 완료 후 결과 파형이 시각화됩니다.', width / 2, height / 2);
            return;
        }

        // 🌟 Highlight Silences overlay (Original Tab only)
        if (tab === 'original' && window.silenceState.audioBuffer && window.silenceState.silences) {
            const silences = window.silenceState.silences;
            const totalOrigDur = window.silenceState.audioBuffer.duration;
            silences.forEach(s => {
                const startX = (s.start / totalOrigDur) * width;
                const endX = (s.end / totalOrigDur) * width;
                const w = Math.max(3, endX - startX);

                ctx.fillStyle = s.remove ? 'rgba(56, 189, 248, 0.28)' : 'rgba(250, 204, 21, 0.28)';
                ctx.fillRect(startX, 0, w, height);

                ctx.strokeStyle = s.remove ? 'rgba(56, 189, 248, 0.8)' : 'rgba(250, 204, 21, 0.8)';
                ctx.lineWidth = 1.2;
                ctx.strokeRect(startX, 0, w, height);
            });
        }

        // 🎨 Waveform Bar Drawing Logic (Dual Fallback)
        if (tab === 'result' && !buffer && window.silenceState.audioBuffer) {
            // [Fallback] Result Buffer 디코딩 준비 중일 때 원본 PCM에서 무음 제거 구간을 압축 시각화!
            const origData = window.silenceState.audioBuffer.getChannelData(0);
            const totalOrigDur = window.silenceState.audioBuffer.duration;
            const sr = window.silenceState.audioBuffer.sampleRate;

            ctx.fillStyle = '#34d399'; // Bright Emerald Green
            for (let i = 0; i < width; i += 2) {
                const timePos = (i / width) * (totalDuration || totalOrigDur);
                const sampleIdx = Math.floor(timePos * sr);
                if (sampleIdx < origData.length) {
                    const datum = origData[sampleIdx];
                    const barHeight = Math.max(3, Math.abs(datum) * amp * 1.7);
                    ctx.fillRect(i, amp - barHeight / 2, 1.5, barHeight);
                }
            }
        } else if (buffer) {
            // [Standard] 파형 렌더링
            const rawData = buffer.getChannelData(0);
            const step = Math.ceil(rawData.length / width);

            ctx.fillStyle = tab === 'original' ? '#38bdf8' : '#34d399';
            for (let i = 0; i < width; i += 2) {
                let min = 1.0;
                let max = -1.0;
                for (let j = 0; j < step; j++) {
                    const datum = rawData[(i * step) + j];
                    if (datum < min) min = datum;
                    if (datum > max) max = datum;
                }

                const barHeight = Math.max(3, (max - min) * amp * 0.85);
                ctx.fillRect(i, amp - barHeight / 2, 1.5, barHeight);
            }
        }

        // 🎯 Moving Playhead Cursor Line (White Line with Glow & Top Handle)
        if (totalDuration > 0) {
            const currX = (currTime / totalDuration) * width;

            ctx.save();

            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 10;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;

            // Main Playhead Line
            ctx.beginPath();
            ctx.moveTo(currX, 0);
            ctx.lineTo(currX, height);
            ctx.stroke();

            // Top Marker Handle Pointer (Triangle)
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.moveTo(currX - 6, 0);
            ctx.lineTo(currX + 6, 0);
            ctx.lineTo(currX, 10);
            ctx.closePath();
            ctx.fill();

            // Bottom Marker Handle Pointer (Triangle)
            ctx.beginPath();
            ctx.moveTo(currX - 6, height);
            ctx.lineTo(currX + 6, height);
            ctx.lineTo(currX, height - 10);
            ctx.closePath();
            ctx.fill();

            ctx.restore();
        }
    };

    window.onSilenceCanvasClick = function(e) {
        const canvas = document.getElementById('silenceWaveformCanvas');
        const total = getCurrentDuration();
        if (!canvas || total <= 0) return;

        const rect = canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const ratio = clickX / rect.width;
        const targetTime = ratio * total;

        const wasPlaying = window.silenceState.isPlaying;

        const audio = getAudioElem();
        if (audio) {
            try { audio.currentTime = targetTime; } catch (err) {}
        }

        window.silenceState.pauseOffset = targetTime;
        drawSilenceWaveform();

        if (wasPlaying) {
            playSilenceAudio(targetTime);
        }
    };

    // ── 다운로드 및 초기화 (스마트 배속/포맷 재인코딩 자동 다운로드) ──────
    window.downloadSilenceResult = async function() {
        const resultData = window.silenceState.resultData;
        const currentSpeed = window.silenceState.speedRate || 1.0;
        const currentFormat = window.silenceState.exportFormat || 'wav';

        // 이전 결과물의 배속/포맷과 현재 설정된 배속/포맷이 다르면 저장 시 자동 재인코딩!
        const needReApply = !resultData ||
                            !resultData.resultFilename ||
                            Math.abs((resultData.speedRate || 1.0) - currentSpeed) > 0.01 ||
                            (resultData.exportFormat || 'wav') !== currentFormat;

        if (needReApply) {
            setDownloadButtonsState(true, '인코딩 중...');
            try {
                await runSilenceApply();
            } catch (err) {
                console.error('[downloadSilenceResult Error]', err);
                alert('저장용 파일 생성 실패: ' + err.message);
                return;
            } finally {
                setDownloadButtonsState(false, '저장');
            }
        }

        const finalData = window.silenceState.resultData;
        if (!finalData || !finalData.resultFilename) {
            alert('저장할 파일이 없습니다. 먼저 [무음제거 / 배속 적용하기]를 실행하세요.');
            return;
        }

        // Electron 환경에서는 window.location.href가 페이지를 이동시켜 버리므로
        // fetch → Blob → <a> 태그 클릭 방식으로 직접 저장
        try {
            const downloadUrl = `${API_BASE}/api/silence/download/${finalData.resultFilename}`;
            setDownloadButtonsState(true, '저장 중...');

            const res = await fetch(downloadUrl);
            if (!res.ok) throw new Error(`서버 응답 오류: ${res.status}`);

            const blob = await res.blob();
            const ext = (finalData.exportFormat || 'wav').toLowerCase();
            const saveFilename = `무음제거_결과_${Date.now()}.${ext}`;

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = saveFilename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 1000);

            if (typeof showToast === 'function') showToast(`💾 "${saveFilename}" 저장 완료!`, 4000);
        } catch (err) {
            console.error('[downloadSilenceResult Error]', err);
            alert('저장 실패: ' + err.message);
        } finally {
            setDownloadButtonsState(false, '저장');
        }
    };

    window.resetSilenceEditor = function() {
        stopSilenceAudio();

        if (window.silenceState.originalObjectUrl) {
            try { URL.revokeObjectURL(window.silenceState.originalObjectUrl); } catch (e) {}
        }
        if (window.silenceState.audioElem) {
            try {
                window.silenceState.audioElem.pause();
                window.silenceState.audioElem.src = '';
            } catch (e) {}
        }

        window.silenceState = {
            file: null,
            fileData: null,
            resultData: null,
            preset: 'talk',
            activeTab: 'original',
            audioBuffer: null,
            resultAudioBuffer: null,
            resultDuration: 0,
            silences: [],
            speedRate: 1.0,
            exportFormat: 'wav',
            zoom: 1,

            audioElem: null,
            originalObjectUrl: null,
            resultAudioUrl: null,
            isPlaying: false,
            pauseOffset: 0
        };

        document.getElementById('silenceFileInput').value = '';
        document.getElementById('btnSilenceDetect').disabled = true;
        document.getElementById('btnSilenceApply').disabled = true;
        setDownloadButtonsState(true);
        document.getElementById('silenceMetaChips').style.display = 'none';
        document.getElementById('silenceNoticeBanner').style.display = 'none';

        updateSilenceSpeedRate(1.0);

        document.getElementById('silenceValRemovedDuration').textContent = '--';
        document.getElementById('silenceValFinalDuration').textContent = '--';
        document.getElementById('silenceValSavedPercent').textContent = '--';

        document.getElementById('silenceDetailList').innerHTML = `<div style="font-size:11px; color:#64748b; text-align:center; padding:16px 0;">오디오 파일 업로드 후 [무음 구간 감지하기]를 진행하거나 원하는 배속으로 적용하세요.</div>`;

        drawSilenceWaveform();
    };

    const SAMPLE_SILENCE_SCRIPT = `80대 택시 기사가 신라호텔 회전문을 산산조각 냈습니다. 수리비만 무려 5억 원. 
기사님이 가입한 보험 한도는 고작 5천만 원뿐, 평생 번 돈을 전부 몰수당하고 길거리에 나앉을 절체절명의 위기였죠. 
담당자들은 당장 전액을 배상하라며 압박해 왔고, 기사님은 억울함과 공포에 떨어야 했습니다. 
그때 보고를 받은 이부진 사장의 행동은 충격적이었습니다.
당장 배상 요구를 전부 중단시키더니, 수행원을 보내 기사님의 처지를 몰래 조사하게 한 겁니다. 
알고 보니 낡은 단칸방에서 몸이 아픈 아내를 돌보며 간신히 살아가는 비참한 형편이었죠.
사연을 들은 이부진은 그 자리에서 일침을 가했습니다.
"우리가 겪은 손해보다 이분이 받으셨을 충격이 더 큽니다.
배상금 4억 원은 전액 면제해 드리고, 치료비까지 전부 회사가 부담하세요."
한순간의 실수로 인생이 끝날 뻔한 힘없는 노인을 거대 기업의 회장이 직접 감싸 안아준 사건.
여러분은 이부진 사장의 이 결단을 어떻게 생각하시나요?`;

    window.loadSampleSilenceScript = function() {
        const input = document.getElementById('silenceScriptInput');
        if (input) input.value = SAMPLE_SILENCE_SCRIPT;
    };

    function formatSrtTimestamp(sec) {
        if (isNaN(sec) || sec < 0) sec = 0;
        const hrs = Math.floor(sec / 3600);
        const mins = Math.floor((sec % 3600) / 60);
        const secs = Math.floor(sec % 60);
        const millis = Math.floor((sec % 1) * 1000);
        return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
    }

    /**
     * Vrew 스타일 의미 단위 (어절/어구 기준 15자 내외) 자막 자동 분할 함수
     */
    function splitTextIntoSemanticChunks(text, maxChars = 15) {
        if (!text) return [];

        const rawParagraphs = text.split('\n').map(p => p.trim()).filter(Boolean);
        const initialSentences = [];

        rawParagraphs.forEach(p => {
            const parts = p.split(/(?<=[.?!,])\s+/).map(x => x.trim()).filter(Boolean);
            if (parts.length > 0) initialSentences.push(...parts);
            else if (p) initialSentences.push(p);
        });

        if (!maxChars || maxChars <= 0) {
            return initialSentences;
        }

        const finalChunks = [];

        initialSentences.forEach(sentence => {
            if (sentence.length <= maxChars) {
                finalChunks.push(sentence);
                return;
            }

            const words = sentence.split(/\s+/).filter(Boolean);
            let currentChunk = '';

            words.forEach(word => {
                if (!currentChunk) {
                    currentChunk = word;
                } else if ((currentChunk + ' ' + word).length <= maxChars + 2) {
                    currentChunk += ' ' + word;
                } else {
                    finalChunks.push(currentChunk);
                    currentChunk = word;
                }
            });

            if (currentChunk) {
                finalChunks.push(currentChunk);
            }
        });

        return finalChunks;
    }

    window.generateAndDownloadSilenceSRT = function() {
        const input = document.getElementById('silenceScriptInput');
        const scriptText = input ? input.value.trim() : '';

        if (!scriptText) {
            alert('대본 텍스트를 입력해 주세요. 입력하신 대본 문장들이 무음 제거 및 배속이 반영된 오디오 시간에 맞춰 .srt 자막 파일로 생성됩니다.');
            return;
        }

        const maxCharsSelect = document.getElementById('silenceMaxCharsSelect');
        const maxChars = maxCharsSelect ? parseInt(maxCharsSelect.value) : 15;

        // 1. Vrew 스타일 15자 내외 의미 단위 어절 분할 실행
        const sentences = splitTextIntoSemanticChunks(scriptText, maxChars);

        if (sentences.length === 0) {
            alert('유효한 문장이 없습니다.');
            return;
        }

        // 2. 최종 오디오 총 길이 정확 취득 (결과 오디오 > 예측 길이 > 원본 오디오)
        let totalDuration = window.silenceState.resultDuration;
        if (!totalDuration || totalDuration <= 0) {
            const fileData = window.silenceState.fileData;
            const silences = window.silenceState.silences || [];
            const speed = window.silenceState.speedRate || 1.0;
            const origDur = fileData ? fileData.metadata.duration : (window.silenceState.audioBuffer ? window.silenceState.audioBuffer.duration : 0);
            const removedDur = silences.filter(s => s.remove).reduce((a, b) => a + b.duration, 0);
            const netDur = Math.max(0.1, origDur - removedDur);
            totalDuration = netDur / speed;
        }

        if (!totalDuration || totalDuration <= 0) {
            totalDuration = 52.271; // fallback
        }

        // 3. 문장별 글자 수 비율 기반 정밀 타임라인 매핑 (오디오 길이 100% 일치)
        const totalChars = sentences.reduce((sum, s) => sum + s.length, 0);
        let cumulativeChars = 0;

        const srtEntries = sentences.map((sentence, idx) => {
            const startRatio = cumulativeChars / totalChars;
            cumulativeChars += sentence.length;
            const endRatio = cumulativeChars / totalChars;

            const startSec = startRatio * totalDuration;
            // 프리미어 프로 / 캡컷 자막 구분을 위해 문장 간 0.04초 미세 갭 적용 (마지막 문장은 오디오 끝과 100% 정밀 일치)
            const endSec = (idx === sentences.length - 1)
                ? totalDuration
                : Math.max(startSec + 0.1, (endRatio * totalDuration) - 0.04);

            return `${idx + 1}\n${formatSrtTimestamp(startSec)} --> ${formatSrtTimestamp(endSec)}\n${sentence}\n`;
        });

        const srtContent = srtEntries.join('\n');

        // 4. SRT 파일 다운로드 실행
        const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const originalName = window.silenceState.file ? window.silenceState.file.name.replace(/\.[^/.]+$/, "") : "무음제거_결과";
        const speed = window.silenceState.speedRate || 1.0;
        a.download = `자막_${originalName}_${speed}x.srt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (typeof showToast === 'function') {
            showToast(`🎉 Vrew 스타일 ${maxChars > 0 ? maxChars + '자' : '문장'} 단위 분할 (총 ${sentences.length}개 클립, ${totalDuration.toFixed(2)}초) 자막 다운로드 완료!`);
        }
    };

    // ── 앱 기본 프리셋 초기화 ('대화 빠르게' 기본) ──────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => selectSilencePreset('talk'));
    } else {
        selectSilencePreset('talk');
    }

})();
