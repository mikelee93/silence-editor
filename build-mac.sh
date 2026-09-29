#!/bin/bash
echo "✂️ 무음 제거 에디터 - Mac 전용 빌드 스크립트 시작..."
npm install
npm run build:mac
echo "🎉 빌드 완료! dist/ 폴더 안에 Mac용 .dmg 및 .zip 파일이 생성되었습니다."
