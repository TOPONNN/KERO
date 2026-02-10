// Spline 키캡 이름은 3D 모델에 고정되어 있으므로 변경 불가
// label과 shortDescription만 KERO 기술스택에 맞게 매핑
// 브랜드 컬러: SimpleIcons v16.7 공식 HEX 코드 기준
// 이름 뒤 ___ 패딩은 Spline 바이너리 msgpack fixstr 호환을 위한 것 (7자 고정)
export enum SkillNames {
  JS = "js",           // → WebRTC
  TS = "ts",           // → TypeScript
  HTML = "html",       // → LiveKit
  CSS = "css",         // → Socket.io
  REACT = "react",     // → React
  VUE = "vue",         // → Redux
  NEXTJS = "nextjs",   // → Next.js
  TAILWIND = "tailwind", // → Tailwind CSS
  NODEJS = "nodejs",   // → Node.js
  EXPRESS = "express",   // → Express.js
  POSTGRES = "postgres", // → MySQL
  MONGODB = "mongodb",   // → Redis
  GIT = "git",           // → RabbitMQ
  GITHUB = "github",     // → Celery
  PRETTIER = "prettier", // → Jenkins
  NPM = "npm",           // → Framer Motion
  FIREBASE = "firebase", // → Flask
  WORDPRESS = "wordpress", // → WhisperX + SOFA
  LINUX = "linux",     // → Linux
  DOCKER = "docker",   // → Docker
  NGINX = "nginx",     // → Nginx
  AWS = "aws",         // → AWS S3
  GCP = "gcp",         // → ELK Stack
  VIM = "vim",         // → Mel-band Roformer
  VERCEL = "vercel",   // → FCPE
  GSAP = "gsap___",
  PYTORCH = "pytorch",
  EC2 = "ec2____",
  TYPEORM = "typeorm",
  YTDLP = "yt_dlp_",
  LENIS = "lenis__",
  KUROSHIRO = "kuroshi",
  SPLINE = "spline_",
}

export type Skill = {
  id: number;
  name: string;
  label: string;
  shortDescription: string;
  color: string;
  /** Optional override for 3D keycap color when brand color clashes with icon */
  keycapColor?: string;
  icon: string;
};

export const SKILLS: Record<SkillNames, Skill> = {
  [SkillNames.JS]: {
    id: 1,
    name: "js",
    label: "WebRTC",
    shortDescription: "실시간 P2P 미디어 스트리밍의 핵심 — 초저지연 음성/영상 통신",
    color: "#2FBF71",
    icon: "/assets/keycap-icons-hd/webrtc.png",
  },
  [SkillNames.TS]: {
    id: 2,
    name: "ts",
    label: "TypeScript",
    shortDescription: "프론트엔드와 백엔드 모두 타입 안전하게 — 버그를 미리 잡는 조력자",
    color: "#3178C6",
    keycapColor: "#1B2838",
    icon: "/assets/keycap-icons-hd/typescript.png",
  },
  [SkillNames.HTML]: {
    id: 3,
    name: "html",
    label: "LiveKit",
    shortDescription: "WebRTC 기반 화상·음성 서버 — 노래방 실시간 스트리밍의 심장",
    color: "#09B3AF",
    icon: "/assets/keycap-icons-hd/livekit.png",
  },
  [SkillNames.CSS]: {
    id: 4,
    name: "css",
    label: "Socket.io",
    shortDescription: "양방향 실시간 통신 — 방 관리, 이벤트 브로드캐스트 담당",
    color: "#C9B8A8",
    icon: "/assets/keycap-icons-hd/socketdotio.png",
  },
  [SkillNames.REACT]: {
    id: 5,
    name: "react",
    label: "React",
    shortDescription: "컴포넌트 기반 UI 라이브러리 — KERO의 모든 화면을 그리는 핵심",
    color: "#61DAFB",
    keycapColor: "#20232A",
    icon: "/assets/keycap-icons-hd/react.png",
  },
  [SkillNames.VUE]: {
    id: 6,
    name: "vue",
    label: "Redux",
    shortDescription: "전역 상태 관리 — 노래방/로비/게임 상태를 일관되게 관리",
    color: "#764ABC",
    icon: "/assets/keycap-icons-hd/redux.png",
  },
  [SkillNames.NEXTJS]: {
    id: 7,
    name: "nextjs",
    label: "Next.js",
    shortDescription: "App Router + SSR로 빌드한 프론트엔드 프레임워크",
    color: "#555555",
    icon: "/assets/keycap-icons-hd/nextdotjs.png",
  },
  [SkillNames.TAILWIND]: {
    id: 8,
    name: "tailwind",
    label: "Tailwind CSS",
    shortDescription: "유틸리티 클래스로 빠르게 스타일링 — 다크 테마 UI의 비밀",
    color: "#38BDF8",
    icon: "/assets/keycap-icons-hd/tailwindcss.png",
  },
  [SkillNames.NODEJS]: {
    id: 9,
    name: "nodejs",
    label: "Node.js",
    shortDescription: "백엔드 런타임 — Express 서버와 실시간 처리의 기반",
    color: "#5FA04E",
    icon: "/assets/keycap-icons-hd/nodedotjs.png",
  },
  [SkillNames.EXPRESS]: {
    id: 10,
    name: "express",
    label: "Express.js",
    shortDescription: "RESTful API + 미들웨어로 설계한 백엔드 서버",
    color: "#7B7B7B",
    icon: "/assets/keycap-icons-hd/express.png",
  },
  [SkillNames.POSTGRES]: {
    id: 11,
    name: "postgres",
    label: "MySQL",
    shortDescription: "관계형 데이터베이스 — 유저, 곡, 점수 데이터를 안정적으로 저장",
    color: "#4479A1",
    icon: "/assets/keycap-icons-hd/mysql.png",
  },
  [SkillNames.MONGODB]: {
    id: 12,
    name: "mongodb",
    label: "Redis",
    shortDescription: "초고속 인메모리 캐시 — 세션 관리와 실시간 데이터 처리",
    color: "#B91C1C",
    icon: "/assets/keycap-icons-hd/redis.png",
  },
  [SkillNames.GIT]: {
    id: 13,
    name: "git",
    label: "RabbitMQ",
    shortDescription: "메시지 큐 — AI 작업 요청을 안정적으로 전달하는 중간 다리",
    color: "#F76D07",
    icon: "/assets/keycap-icons-hd/rabbitmq.png",
  },
  [SkillNames.GITHUB]: {
    id: 14,
    name: "github",
    label: "Celery",
    shortDescription: "Python 비동기 작업 큐 — GPU 서버에서 AI 작업을 분산 처리",
    color: "#37814A",
    icon: "/assets/keycap-icons-hd/celery.png",
  },
  [SkillNames.PRETTIER]: {
    id: 15,
    name: "prettier",
    label: "Jenkins",
    shortDescription: "CI/CD 파이프라인 — git push 한 번으로 자동 빌드·배포",
    color: "#CC6633",
    icon: "/assets/keycap-icons-hd/jenkins.png",
  },
  [SkillNames.NPM]: {
    id: 16,
    name: "npm",
    label: "Framer Motion",
    shortDescription: "부드러운 애니메이션 라이브러리 — 페이지 전환과 인터랙션 담당",
    color: "#0044CC",
    icon: "/assets/keycap-icons-hd/framer.png",
  },
  [SkillNames.FIREBASE]: {
    id: 17,
    name: "firebase",
    label: "Flask",
    shortDescription: "Python 경량 웹 프레임워크 — AI Worker 서버를 간결하게 구현",
    color: "#1D1D1D",
    icon: "/assets/keycap-icons-hd/flask.png",
  },
  [SkillNames.WORDPRESS]: {
    id: 18,
    name: "wordpress",
    label: "SOFA",
    shortDescription: "강제 정렬 모델 — 음소 단위 가사 타이밍을 정밀하게 생성",
    color: "#412991",
    icon: "/assets/keycap-icons-hd/sofa.png",
  },
  [SkillNames.LINUX]: {
    id: 19,
    name: "linux",
    label: "Linux",
    shortDescription: "Ubuntu 서버 — 모든 서비스가 돌아가는 안정적인 운영 체제",
    color: "#ffffff",
    icon: "/assets/keycap-icons-hd/linux.png",
  },
  [SkillNames.DOCKER]: {
    id: 20,
    name: "docker",
    label: "Docker",
    shortDescription: "컨테이너화로 환경 통일 — 10개 서비스를 한 번에 배포",
    color: "#2496ed",
    icon: "/assets/keycap-icons-hd/docker.png",
  },
  [SkillNames.NGINX]: {
    id: 21,
    name: "nginx",
    label: "Nginx",
    shortDescription: "리버스 프록시 + SSL — kero.ooo로 들어오는 모든 트래픽을 관리",
    color: "#009639",
    icon: "/assets/keycap-icons-hd/nginx.png",
  },
  [SkillNames.AWS]: {
    id: 22,
    name: "aws",
    label: "AWS S3",
    shortDescription: "클라우드 스토리지 — 음원, MR, 보컬 파일을 안전하게 저장",
    color: "#8BC34A",
    icon: "/assets/keycap-icons-hd/amazons3.png",
  },
  [SkillNames.GCP]: {
    id: 23,
    name: "gcp",
    label: "ELK Stack",
    shortDescription: "Elasticsearch + Logstash + Kibana — 로그 수집·분석·시각화",
    color: "#005571",
    icon: "/assets/keycap-icons-hd/elasticsearch.png",
  },
  [SkillNames.VIM]: {
    id: 24,
    name: "vim",
    label: "Mel-band Roformer",
    shortDescription: "최신 음원 분리 AI — 노래에서 보컬과 MR을 고품질로 분리",
    color: "#0C7BDC",
    icon: "/assets/keycap-icons-hd/meta.png",
  },
  [SkillNames.VERCEL]: {
    id: 25,
    name: "vercel",
    label: "FCPE",
    shortDescription: "실시간 음정 분석 AI — 빠르고 정확한 F0 추출로 노래 점수 계산",
    color: "#8B5CF6",
    icon: "/assets/keycap-icons-hd/fcpe.png",
  },
  [SkillNames.GSAP]: {
    id: 26,
    name: "gsap___",
    label: "GSAP",
    shortDescription: "고성능 애니메이션 엔진 — 스크롤 트리거와 3D 카메라 전환",
    color: "#0AE448",
    keycapColor: "#132B1A",
    icon: "/assets/keycap-icons-hd/gsap.png",
  },
  [SkillNames.PYTORCH]: {
    id: 27,
    name: "pytorch",
    label: "PyTorch",
    shortDescription: "GPU AI 프레임워크 — 음원 분리·음정 분석·정렬 모델의 핵심 런타임",
    color: "#EE4C2C",
    icon: "/assets/keycap-icons-hd/pytorch.png",
  },
  [SkillNames.EC2]: {
    id: 28,
    name: "ec2____",
    label: "AWS EC2",
    shortDescription: "클라우드 컴퓨팅 — 메인 서버와 GPU 스팟 인스턴스 운영",
    color: "#FF9900",
    icon: "/assets/keycap-icons-hd/ec2.png",
  },
  [SkillNames.TYPEORM]: {
    id: 29,
    name: "typeorm",
    label: "TypeORM",
    shortDescription: "TypeScript ORM — 엔티티 기반 데이터베이스 스키마 관리",
    color: "#E83524",
    icon: "/assets/keycap-icons-hd/typeorm.png",
  },
  [SkillNames.YTDLP]: {
    id: 30,
    name: "yt_dlp_",
    label: "yt-dlp",
    shortDescription: "YouTube 오디오 추출 — 노래 검색 결과를 실시간 스트리밍",
    color: "#FF0000",
    icon: "/assets/keycap-icons-hd/ytdlp.png",
  },
  [SkillNames.LENIS]: {
    id: 31,
    name: "lenis__",
    label: "Lenis",
    shortDescription: "부드러운 스크롤 라이브러리 — 자연스러운 페이지 전환 경험",
    color: "#4ADE80",
    icon: "/assets/keycap-icons-hd/lenis.png",
  },
  [SkillNames.KUROSHIRO]: {
    id: 32,
    name: "kuroshi",
    label: "Kuroshiro",
    shortDescription: "일본어 가사 변환 — 한국어 발음 표기와 아티스트명 번역",
    color: "#E91E63",
    icon: "/assets/keycap-icons-hd/kuroshiro.png",
  },
  [SkillNames.SPLINE]: {
    id: 33,
    name: "spline_",
    label: "Spline",
    shortDescription: "3D 웹 시각화 도구 — 인터랙티브 키보드 씬 렌더링",
    color: "#C74FEB",
    icon: "/assets/keycap-icons-hd/spline.png",
  },
};
