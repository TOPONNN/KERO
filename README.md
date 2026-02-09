<p align="center">
  <h1 align="center">KERO</h1>
  <p align="center">
    AI 기반 실시간 온라인 노래방 플랫폼
    <br />
    <a href="https://kero.ooo"><strong>kero.ooo</strong></a>
  </p>
</p>

## 소개

KERO는 WebRTC 기반의 실시간 온라인 노래방 플랫폼입니다.  
저지연 음성/영상 통신과 AI 음악 분석 기술을 결합하여, 친구들과 함께 노래하고 점수를 겨루는 경험을 제공합니다.

## 주요 기능

### 실시간 노래방
- WebRTC(LiveKit) + Socket.io 기반 저지연 음성/영상 통신
- 최대 6명이 함께 참여하는 멀티 유저 방
- 호스트 중심의 곡 대기열 관리 및 게임 상태 동기화

### AI 음원 처리 파이프라인
- **보컬 분리** - Mel-Band Roformer로 원곡에서 보컬/MR 고품질 분리
- **가사 자동 싱크** - SOFA(Singing-Oriented Forced Aligner)로 음소 단위 가사 정렬
- **음정 분석** - FCPE 모델로 실시간 음정 추출 및 점수 산출
- RabbitMQ 기반 비동기 처리 워커

### 게임 모드
| 모드 | 설명 |
|------|------|
| **일반** | 자유롭게 노래를 즐기는 기본 모드 |
| **퍼펙트 스코어** | AI 음정 분석으로 실시간 점수를 겨루는 모드 |
| **노래 퀴즈** | 가사 빈칸, 제목/가수 맞추기, 초성 퀴즈, 가사 순서, O/X 등 6종 퀴즈 |

### 곡 검색 및 지원
- TJ 노래방 차트 연동 (한국곡/일본곡/팝송)
- YouTube 기반 곡 검색 및 자동 처리
- 일본곡 한국어 발음 가사 자동 변환 (Kuroshiro)

## 아키텍처

```
┌─────────────┐    ┌─────────────────┐    ┌──────────────┐
│  Frontend    │    │    Backend       │    │  AI Worker   │
│  Next.js 15  │◄──►│  Express.js     │◄──►│  Python      │
│  React 19    │    │  Socket.io      │    │  PyTorch     │
│  TypeScript  │    │  TypeORM        │    │  WhisperX    │
└──────┬───────┘    └───────┬─────────┘    └──────┬───────┘
       │                    │                      │
       │              ┌─────┴─────┐                │
       │              │           │                │
  ┌────▼────┐   ┌─────▼───┐ ┌────▼────┐    ┌──────▼──────┐
  │ LiveKit │   │  MySQL  │ │  Redis  │    │  RabbitMQ   │
  │ (WebRTC)│   │         │ │ Pub/Sub │    │  Task Queue │
  └─────────┘   └─────────┘ └─────────┘    └─────────────┘
                      │
              ┌───────┴────────┐
              │   AWS S3       │
              │  Audio Storage │
              └────────────────┘
```

## 기술 스택

### Frontend
| 기술 | 용도 |
|------|------|
| Next.js 15 | App Router + SSR |
| React 19 | UI 컴포넌트 |
| TypeScript | 타입 안전성 |
| Tailwind CSS | 스타일링 |
| Redux Toolkit | 상태 관리 |
| Framer Motion / GSAP | 애니메이션 |
| Spline | 3D 인터랙티브 키보드 |
| LiveKit Client | WebRTC 미디어 |

### Backend
| 기술 | 용도 |
|------|------|
| Express.js | REST API |
| Socket.io | 실시간 이벤트 |
| TypeORM + MySQL | 데이터 영속화 |
| Redis | Pub/Sub, 캐시, 온라인 상태 |
| RabbitMQ | 비동기 작업 큐 |
| LiveKit Server SDK | 미디어 토큰 발급 |
| AWS S3 | 오디오 파일 저장 |
| Kuroshiro | 일본어 음성학 변환 |
| yt-dlp | YouTube 오디오 추출 |

### AI Worker
| 기술 | 용도 |
|------|------|
| Python 3.12 | 런타임 |
| PyTorch (CUDA) | GPU 추론 |
| Mel-Band Roformer | 보컬/MR 분리 |
| WhisperX | 음성 인식 |
| SOFA | 가사 강제 정렬 |
| FCPE | 음정 추출 |
| yt-dlp | YouTube 다운로드 |

### 인프라
| 기술 | 용도 |
|------|------|
| Docker Compose | 컨테이너 오케스트레이션 |
| Nginx | 리버스 프록시 + SSL |
| Jenkins | CI/CD 파이프라인 |
| AWS EC2 + S3 | 컴퓨팅 + 스토리지 |
| ELK Stack | 로깅 + 모니터링 |

## 프로젝트 구조

```
.
├── frontend/          # Next.js 애플리케이션
├── backend/           # Express API + Socket 서버
├── ai-worker/         # Python AI 처리 워커
├── docker-compose.yml # 코어 서비스 오케스트레이션
├── nginx/             # Nginx 설정
├── livekit/           # LiveKit 서버 설정
├── elk/               # Elasticsearch + Logstash + Kibana
├── rabbitmq/          # RabbitMQ 설정
└── Jenkinsfile        # CI/CD 파이프라인 정의
```

## 환경 설정

각 서비스별 `.env.example`을 참고하여 `.env` 파일을 생성합니다.

| 위치 | 파일 |
|------|------|
| 루트 | `.env.example` |
| 백엔드 | `backend/.env.example` |
| AI 워커 | `ai-worker/.env.example` |

필수 설정 항목:
- MySQL / Redis / RabbitMQ 접속 정보
- JWT 시크릿
- AWS S3 인증 정보 및 버킷
- LiveKit API Key / Secret
- AI Worker 콜백 시크릿

## 실행 방법

### Docker (권장)

```bash
# 1. 환경변수 설정
cp .env.example .env
cp backend/.env.example backend/.env

# 2. 코어 서비스 실행
docker compose up -d --build

# 3. AI 워커 실행 (GPU 필요)
cd ai-worker
docker compose up -d --build
```

### 로컬 개발

```bash
# Backend
cd backend && npm install && npm run dev

# Frontend
cd frontend && npm install && npm run dev
```

> AI Worker는 GPU 및 시스템 의존성이 많아 Docker 사용을 권장합니다.

## API 엔드포인트

| 경로 | 설명 |
|------|------|
| `/api/auth` | 회원가입, 로그인, 카카오 소셜 로그인, 프로필 관리 |
| `/api/rooms` | 방 생성/조회/참여/삭제 |
| `/api/songs` | 곡 업로드, 처리 상태 조회, 퀴즈 생성 |
| `/api/search` | TJ 차트 검색, YouTube 검색 |
| `/api/livekit/token` | WebRTC 미디어 토큰 발급 |
| `/api/health` | 서버 상태 확인 |

## 팀

**Team KERO**

윤희준 &middot; 정훈호 &middot; 김관익 &middot; 김성민 &middot; 박찬진 &middot; 윤희망
