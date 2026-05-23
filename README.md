# DockerRos — 로봇 시뮬레이터 + ROS2 학습 환경

ROS2 Humble 기반 로봇 학습/실습 키트입니다. 두 가지 시뮬레이터를 함께 제공합니다.

1. **웹 시뮬레이터** (브라우저, Three.js) — 의존성 거의 없음. 강의·시연·데모용. PLC(OPC UA) 연동 지원.
2. **네이티브 ROS2 시뮬레이터** (RViz2 / Gazebo Classic) — Apple Silicon에서 RoboStack(conda) 기반으로 직접 실행. 정식 코스워크용.
3. **Docker ROS2 환경** (보조) — 재현 가능한 클린룸 환경. 단, **3D GUI(RViz/Gazebo)는 macOS에서 실용적이지 않음** — 2D Qt(rqt) 정도만 동작.

---

## 📋 목차

- [최소 사양](#-최소-사양)
- [필요한 소프트웨어](#-필요한-소프트웨어)
  - [A. 웹 시뮬만](#-a-웹-시뮬레이터만-쓸-때--이게-90-사용-케이스)
  - [B. PLC 연동까지](#-b-plcopc-ua-연동까지-쓸-때)
  - [C. 네이티브 ROS2](#-c-네이티브-ros2-rviz--gazebo-추가로-쓸-때)
  - [D. Docker (선택)](#-d-docker-ros2-환경-선택-보조용)
- [지원 로봇 모델](#-지원-로봇-모델)
- [폴더 구조](#-폴더-구조)
- [설치 가이드](#-설치-가이드)
  - [A. 웹 시뮬 — macOS](#-a-웹-시뮬만--macos)
  - [A'. 웹 시뮬 — Windows](#-a-웹-시뮬만--windows)
  - [B. PLC 연동 — Windows](#-b-plc-연동--windows-권장)
  - [B'. PLC 연동 — macOS](#-b-plc-연동--macos-개발용--부분-운영)
  - [C. 네이티브 ROS2 — macOS](#-c-네이티브-ros2-rviz--gazebo--macos-전용)
  - [D. Docker — macOS/Linux](#-d-docker-ros2--macos--linux-선택-보조)
- [⚠️ 주의점](#️-주의점)
  - [A. 설치할 때 주의점](#a-설치할-때-주의점)
  - [B. PLC 연결 주의점](#b-plc-연결-주의점)
- [🚀 사용법](#-사용법)
  - [1️⃣ 웹 시뮬 단독](#1️⃣-웹-시뮬-단독-사용법) — 시작 / UI / 조작 / 시나리오 / 주문 / 단축키
  - [2️⃣ 웹 시뮬 + PLC 연동](#2️⃣-웹-시뮬--plc-연동-사용법) — 흐름도 / 4단계 실행 / 태그 매핑 / 디버깅
  - [3️⃣ 네이티브 ROS2](#3️⃣-네이티브-ros2-rvizgazebo-사용법) — `.command` 카탈로그 / 셸 사용 / 패키지 빌드
  - [4️⃣ Docker](#4️⃣-docker-ros2-사용법) — 라이프사이클 / 컨테이너 내부
- [📑 런처 파일 빠른 참조](#-런처-파일-빠른-참조-cheatsheet)
- [기타 트러블슈팅](#-기타-트러블슈팅)

---

## 💻 최소 사양

| 사용 방식 | CPU | RAM | 디스크 | GPU | OS |
|---|---|---|---|---|---|
| **웹 시뮬만** | 듀얼코어 1.6GHz+ | 4GB | 200MB | WebGL2 지원 통합 GPU | macOS / Windows / Linux |
| **네이티브 ROS2 (RViz/Gazebo)** | Apple Silicon (M1/M2/M3/M4) 또는 x86_64 4코어+ | 8GB (16GB 권장) | 10GB+ | Metal(macOS) / OpenGL 3.3+ | macOS 12+, Ubuntu 22.04 |
| **Docker ROS2** | x86_64/arm64 4코어+ | 8GB+ | 15GB+ | (3D는 사실상 미지원, 2D만) | macOS / Linux + Docker Desktop |
| **PLC 연동까지 풀스택** | 위 + Windows | + 4GB (GX Sim용) | + 5GB | — | Windows 10/11 (GX Works2 의존) |

> 권장: **Apple Silicon Mac (M1 이상) + 16GB RAM**. 본 환경은 M4 Max 128GB에서 검증되었습니다.

> 브라우저: **Chrome / Edge / Safari 최신** (WebGL2 + ES Modules 필수).

---

## 🔧 필요한 소프트웨어

> ✏️ **TL;DR** — 본인 사용 용도에 맞춰 한 번에 보기:
>
> - 🌐 **웹 시뮬만** → Python 3.10+ / 최신 브라우저 — **이게 전부**
> - 🔌 **+ PLC 연동까지** → 위 + Python 3.12 + GX Works2 + GX Simulator + 정공MES브릿지
> - 🤖 **+ 네이티브 ROS2** → 위 + Miniforge + RoboStack `ros2_humble` + XQuartz (macOS 전용)
> - 🐳 **+ Docker** → Docker Desktop (선택)

---

### 🌐 A. 웹 시뮬레이터만 쓸 때 ✅ 이게 90% 사용 케이스

브라우저에서 도는 3D 시뮬이라 **거의 0설치**입니다.

| # | 컴포넌트 | 용도 | 설치 |
|---|---|---|---|
| 1 | **Python 3.10+** | `web/serve.py` 정적 파일 서버 | macOS: 기본 탑재 / Windows: [python.org](https://www.python.org/downloads/) (✅ "Add Python to PATH" 체크) |
| 2 | **최신 브라우저** | Three.js + WebGL2 렌더링 | Chrome / Edge / Safari |
| 3 | (선택) Git | 저장소 클론 | macOS: `xcode-select --install` / Windows: [git-scm.com](https://git-scm.com/) |

> Three.js, urdf-loader, roslib 같은 **브라우저 라이브러리는 CDN(esm.sh)에서 자동 로드** — 직접 npm install 할 게 없습니다.

---

### 🔌 B. PLC(OPC UA) 연동까지 쓸 때

웹 시뮬 + GX Works2 래더 로직과 실시간 양방향 통신하려면 추가로 다음이 필요합니다.

| # | 컴포넌트 | 용도 | 비고 |
|---|---|---|---|
| 1 | **A의 모든 항목** | 웹 시뮬 자체 | — |
| 2 | **Python 3.12** | OPC UA 어댑터 (`asyncua`) | 3.13/3.14는 `asyncua 1.1.8`과 호환성 이슈 — **반드시 3.12** |
| 3 | **GX Works2** | 미쓰비시 PLC 래더 작성 | Windows 전용 (미쓰비시 정품) |
| 4 | **GX Simulator2 또는 3** | PLC 가상 실행 | GX Works2와 함께 설치 |
| 5 | **정공MES브릿지** | PLC ↔ OPC UA 게이트웨이 | `opc.tcp://127.0.0.1:4840`에 OPC UA 서버를 띄움 |
| 6 | **Python 패키지: `asyncua`, `websockets`** | 어댑터 의존 | `OPC UA 어댑터.command/.bat`이 첫 실행 시 venv에 자동 설치 — 수동 X |
| 7 | **방화벽 포트 허용** | 통신 | 4840 (OPC UA), 8090 (웹), 9091 (어댑터 WS) |

> 전체 흐름: GX Works2 → GX Simulator → 정공MES브릿지 → **OPC UA 어댑터(이 저장소)** → 웹 시뮬 브라우저

> **권장 OS**: PLC 도구가 Windows 전용이라 Windows 10/11에서 풀스택 운영을 권장. 단, 어댑터 + 웹 시뮬 부분만 macOS에서 돌리고 PLC만 Windows에서 띄워서 LAN으로 OPC UA 4840을 노출시켜도 동작합니다.

---

### 🤖 C. 네이티브 ROS2 (RViz / Gazebo) 추가로 쓸 때

위 A·B와 별개. 코스워크에서 RViz2/Gazebo Classic을 직접 띄울 때만 필요합니다 (macOS 전용 — Apple Silicon 검증됨).

| # | 컴포넌트 | 용도 | 설치 |
|---|---|---|---|
| 1 | **Miniforge / Conda** | RoboStack 채널용 패키지 매니저 | `brew install --cask miniforge` |
| 2 | **RoboStack `ros2_humble` 환경** | ROS2 Humble + Gazebo + RViz | 아래 [설치 가이드](#-설치-가이드) C단계 참조 |
| 3 | **XQuartz** | X11 GUI 표시 (3D 창) | `brew install --cask xquartz` |
| 4 | **Xcode CLI tools** | 컴파일러 (colcon 빌드용) | `xcode-select --install` |

---

### 🐳 D. Docker ROS2 환경 (선택, 보조용)

> ⚠️ macOS에서 RViz/Gazebo는 Docker 경유 시 **3D는 안 뜹니다**. rqt 같은 2D Qt만 됨. 풀 시뮬은 C번 네이티브 경로 사용.

| # | 컴포넌트 | 설치 |
|---|---|---|
| 1 | **Docker Desktop** | https://docs.docker.com/desktop/ |
| 2 | **XQuartz** (macOS, 선택) | `brew install --cask xquartz` (2D GUI 보고 싶을 때) |

---

## 🤖 지원 로봇 모델

### 웹 시뮬 ([web/robots/](web/robots/))

| 로봇 | DOF | 제조사 | 비고 |
|---|---|---|---|
| **Indy7** | 6 | Neuromeka | 기본 시나리오 메인 로봇 (3대 라인업) |
| **Indy12** | 6 | Neuromeka | 대형 페이로드 |
| **UR5e** | 6 | Universal Robots | — |
| **UR10e** | 6 | Universal Robots | — |
| **Panda** | 7 | Franka Emika | 7DOF |
| **Fanuc M-10iA** | 6 | Fanuc | — |

### 네이티브 ROS2 ([ros2_ws/src/](ros2_ws/src/))

| 패키지 | 설명 |
|---|---|
| `hello_ros2` | 최소 Python pub/sub 템플릿 (talker/listener on `chatter` topic) |
| `indy-ros2` | Neuromeka Indy 시리즈 description (xacro/URDF) |
| `robot_viewer` | 범용 URDF 뷰어 (`view.launch.py`) |

추가로 RoboStack 환경의 share에 포함된 모델:
- `moveit_resources_panda_description` (Panda)
- `moveit_resources_fanuc_description` (Fanuc M-10iA)
- `ur_description` (UR3e/UR5/UR5e/UR10/UR10e/UR16e/UR20/UR30)
- `turtlebot3_*` (Burger / Waffle / Waffle Pi)

---

## 📁 폴더 구조

```
DockerRos/
├── web/                       # 웹 시뮬레이터 (브라우저)
│   ├── index.html             # 메인 UI
│   ├── app.js                 # 브라우저 앱 조립부
│   ├── robot.js               # 기존 경로 호환 wrapper
│   ├── scenarios.js           # 기존 경로 호환 wrapper
│   ├── sim-objects.js         # 기존 경로 호환 wrapper
│   ├── opcua-client.js        # 기존 경로 호환 wrapper
│   ├── opcua_ws_adapter.py    # OPC UA ↔ WebSocket 어댑터 서버
│   ├── order-panel.js         # 기존 경로 호환 wrapper
│   ├── trail.js               # 기존 경로 호환 wrapper
│   ├── socket_picking_bridge.js # ROS 라인 이벤트 bridge wrapper
│   ├── src/                   # DDD 모듈화된 웹 시뮬레이터 코드
│   │   ├── public-api/        # 외부 import용 공개 API
│   │   ├── app/               # 브라우저 부팅/조립 지원
│   │   ├── shared/            # 공통 이벤트/값 객체
│   │   ├── domains/
│   │   │   ├── robot-control/       # 로봇 config, IK, RobotInstance, RobotManager, tool mesh
│   │   │   ├── factory-simulation/  # 설비 객체, registry, inspector, 객체 catalog
│   │   │   │   └── objects/         # conveyors/sockets/trays/storage/inspection/weighing
│   │   │   ├── production-flow/     # 주문/생산 흐름
│   │   │   ├── scenario-authoring/  # 3-로봇 소켓 분류 라인 시나리오
│   │   │   └── connectivity/        # OPC UA/ROS 연결
│   │   └── infrastructure/
│   │       └── three/         # Three.js 렌더링 유틸/트레일
│   ├── serve.py / serve.sh    # 정적 파일 서버 (port 8090, no-cache)
│   └── robots/                # URDF + 메시 (indy7, indy12, ur5e, ur10e, panda, fanuc)
│
├── ros2_ws/                   # ROS2 colcon 워크스페이스
│   ├── src/
│   │   ├── hello_ros2/        # pub/sub 예제 (ament_python)
│   │   ├── indy-ros2/         # Indy URDF/xacro 패키지
│   │   └── robot_viewer/      # 범용 URDF 뷰어 launch
│   ├── build/ install/ log/   # colcon 산출물 (gitignored)
│
├── scripts/                   # 런처가 호출하는 셸 헬퍼들
│   ├── _common.sh             # conda activate + 워크스페이스 overlay
│   ├── run-robot-viewer.sh    # 범용 URDF 뷰어
│   ├── run-gazebo.sh          # Gazebo Classic
│   ├── run-rviz.sh            # RViz2
│   ├── run-ur-viewer.sh       # UR 슬라이더 뷰어
│   ├── run-ur5.sh             # UR + Gazebo Fortress + MoveIt2
│   ├── run-turtlebot3.sh      # TurtleBot3 (empty/world/house)
│   ├── run-teleop.sh          # 키보드 조종
│   ├── run-rosbridge.sh       # rosbridge_server (ws://localhost:9090)
│   ├── ros-shell.sh           # ROS2 환경 활성화된 셸
│   └── gui-test.sh            # xeyes (X11 점검)
│
├── *.command                  # macOS 더블클릭 런처
├── *.bat                      # Windows 더블클릭 런처
├── activate_native.sh         # 네이티브 conda 환경 활성화
├── Dockerfile                 # ros:humble-ros-base 기반
├── docker-compose.yml         # arm64 컨테이너 정의
└── run.sh                     # Docker 런처 (build/up/shell/down/...)
```

---

## ⚙️ 설치 가이드

각 트랙은 **독립적**입니다. 본인이 쓰려는 만큼만 설치하세요.

### 0. 공통 — 저장소 받기

```bash
# macOS / Linux
cd ~/Documents
git clone <repo-url> DockerRos
cd DockerRos
```

```bat
:: Windows (PowerShell 또는 cmd)
cd %USERPROFILE%\Documents
git clone <repo-url> DockerRos
cd DockerRos
```

> Git이 없거나 zip으로 받았다면 단순히 `DockerRos/` 폴더를 원하는 위치에 풀어두면 됩니다.

---

### 🌐 A. 웹 시뮬만 — macOS

```bash
# 1) Python 확인 (macOS는 보통 기본 탑재)
python3 --version    # 3.10 이상이면 OK

# 2) 끝. .command 파일 더블클릭하면 됩니다.
open "웹 시뮬.command"
```

`.command` 파일이 "권한 없음"이라며 안 열리면:
```bash
chmod +x "웹 시뮬.command" "OPC UA 어댑터.command" *.command scripts/*.sh
```

처음 더블클릭할 때 macOS Gatekeeper가 막을 수 있음 → **시스템 설정 → 개인정보 보호 및 보안** 하단의 "이대로 열기" 클릭.

---

### 🌐 A'. 웹 시뮬만 — Windows

```
1) Python 3.10+ 설치
   - https://www.python.org/downloads/ 에서 인스톨러 다운로드
   - 설치 시 "Add Python to PATH" 반드시 체크 ✅
   - 설치 후 cmd에서 확인:  python --version

2) 저장소 받기 (위의 0번 참조)

3) [웹 시뮬.bat] 더블클릭
   - 콘솔 창이 뜨고 자동으로 브라우저가 http://localhost:8090 으로 열림
   - 종료: 콘솔 창에서 Ctrl+C 또는 창 닫기
```

> Windows Defender SmartScreen 경고가 뜨면 **"추가 정보" → "실행"** 클릭.

> 회사/학교 PC에서 Python 설치 권한이 없으면 [Python embeddable zip](https://www.python.org/ftp/python/3.12.0/python-3.12.0-embed-amd64.zip)을 풀어서 PATH 등록만 해도 동작합니다.

---

### 🔌 B. PLC 연동 — Windows (권장)

PLC 풀스택 운영 시 가장 자연스러운 환경.

```
1) 위의 A' (웹 시뮬 Windows 설치) 완료

2) Python 3.12 추가 설치 ⚠️ 중요
   - https://www.python.org/downloads/release/python-3120/
   - asyncua 1.1.8이 Python 3.13/3.14의 PEP 749(lazy annotations)와
     호환 안 됨 → 반드시 3.12를 별도 설치
   - 설치 시 "py launcher" 옵션 켜두면 'py -3.12' 로 호출 가능

3) GX Works2 + GX Simulator2/3 설치 (미쓰비시 정품 라이선스)

4) 정공MES브릿지 설치
   - 이걸 띄우면 OPC UA 서버가 opc.tcp://127.0.0.1:4840 에 뜸
   - run_bridge.bat 또는 패키징된 exe 둘 중 편한 거 사용

5) 방화벽 포트 허용
   - Windows Defender 방화벽 → 인바운드 규칙 추가:
     * 4840 (OPC UA, 정공MES브릿지)
     * 8090 (웹 시뮬 HTTP)
     * 9091 (어댑터 WebSocket)

6) 실행 순서 (매번 PC 켤 때마다)
   a. GX Simulator3 시작 → GX Works2에서 모니터링 시작
   b. 정공MES브릿지 실행 (4840 OPC UA 서버 가동 확인)
   c. [OPC UA 어댑터.bat] 더블클릭
      → 첫 실행 시: web\opcua_venv\ 자동 생성 + asyncua/websockets 설치 (1~2분)
      → 두 번째 실행부터는 즉시 시작
   d. [웹 시뮬.bat] 더블클릭
   e. 브라우저 우측 패널 → "OPC UA (PLC 연동) ✓ 연결됨" 확인
```

> 어댑터 venv를 강제로 Python 3.12로 만들고 싶을 때 (`py launcher`가 깔려 있으면):
> ```bat
> py -3.12 -m venv web\opcua_venv
> web\opcua_venv\Scripts\python.exe -m pip install asyncua websockets
> ```
> 위처럼 한 번 만들어두면 `OPC UA 어댑터.bat`이 그 venv를 그대로 사용합니다.

---

### 🔌 B'. PLC 연동 — macOS (개발용 / 부분 운영)

GX Works2가 Windows 전용이라 PLC 자체는 Windows에서 돌리되, **OPC UA 어댑터 + 웹 시뮬은 Mac에서** 돌리고 싶을 때.

```bash
# 1) Python 3.12 설치 (asyncua 호환)
brew install python@3.12

# 2) Windows 머신과 같은 LAN에 두고 정공MES브릿지를 외부 IP로 노출
#    그리고 web/opcua_ws_adapter.py 의 OPCUA_ENDPOINT 를 수정:
#    OPCUA_ENDPOINT = "opc.tcp://<windows-ip>:4840/smartfactory/server/"

# 3) 실행
./OPC\ UA\ 어댑터.command   # 첫 실행 시 web/opcua_venv 자동 생성
./웹\ 시뮬.command
```

---

### 🤖 C. 네이티브 ROS2 (RViz / Gazebo) — macOS 전용

```bash
# 1) Miniforge 설치 (Anaconda/Miniconda 깔려있으면 스킵)
brew install --cask miniforge

# 2) Xcode CLI tools (compilers)
xcode-select --install

# 3) RoboStack 채널로 ros2_humble 환경 생성 (~5GB, 10분 정도 소요)
conda create -n ros2_humble -c robostack-staging -c conda-forge \
    ros-humble-desktop \
    ros-humble-gazebo-ros-pkgs \
    ros-humble-xacro \
    ros-humble-rmw-cyclonedds-cpp \
    colcon-common-extensions \
    compilers

# 4) XQuartz 설치 + 설정
brew install --cask xquartz
open -a XQuartz
# XQuartz Preferences → Security → "Allow connections from network clients" 체크
# (XQuartz 한 번 종료 후 다시 실행해야 적용됨)
xhost + 127.0.0.1

# 5) 워크스페이스 빌드
cd ~/Documents/DockerRos
source ./activate_native.sh   # conda env 활성화 + 환경변수 설정
cd ros2_ws
colcon build --symlink-install
source install/setup.sh        # zsh OK (.bash 아님!)

# 6) 검증 — Indy7 뷰어 한 번 띄워보기
cd ..
./Indy7\ 팔\ 뷰어.command
```

검증된 사양: 285개 패키지(ROS 패키지 272개) 설치, 약 5GB.

> ROS2 Humble은 Windows에서 ROS2 자체적으로는 지원되긴 하지만, **본 저장소는 Apple Silicon RoboStack에 맞춰져 있음**. Windows에서 ROS2가 필요하면 WSL2 + Ubuntu 22.04 + ROS2 Humble을 별도로 설치하세요. (`.command` 런처는 그대로는 안 돕니다.)

---

### 🐳 D. Docker ROS2 — macOS / Linux (선택, 보조)

```bash
# 1) Docker Desktop 설치
#    https://docs.docker.com/desktop/

# 2) (선택) XQuartz — 2D Qt GUI만 보고 싶을 때
brew install --cask xquartz

# 3) 이미지 빌드 + 컨테이너 가동
cd ~/Documents/DockerRos
./run.sh build      # dockeros:humble 이미지 (~4.65GB) — 5~10분
./run.sh up         # 컨테이너 백그라운드 가동
./run.sh shell      # 컨테이너 안으로 진입

# 컨테이너 안에서:
ros2 run hello_ros2 talker    # 다른 터미널에서 listener 띄워서 확인
```

> Windows에서 Docker로 돌리려면 Docker Desktop + WSL2 백엔드 필요. 단, GUI 창 띄우려면 X 서버(VcXsrv 등) 별도 설치가 필요한데 권장하지 않음.

---

## ⚠️ 주의점

### A. 설치할 때 주의점

| # | 항목 | 설명 |
|---|---|---|
| 1 | **Windows: Python "Add to PATH" 필수** | 인스톨러에서 이 체크박스 놓치면 `.bat` 파일들이 전부 "Python not found" 에러. 이미 설치했는데 PATH가 빠졌다면 재설치 또는 환경변수에서 수동 추가. |
| 2 | **Windows: Python 3.12 별도 필요 (PLC 연동 시)** | 시스템 기본 Python이 3.13/3.14여도 무방하지만, OPC UA 어댑터용으로는 3.12가 별도로 깔려 있어야 함. `py -3.12 --version`으로 확인. |
| 3 | **macOS: `.command` 권한** | git clone 직후엔 실행 권한이 빠져 있을 수 있음 → `chmod +x *.command scripts/*.sh`. |
| 4 | **macOS: Gatekeeper / 공증** | 처음 더블클릭 시 "확인되지 않은 개발자" 경고 → 시스템 설정에서 "이대로 열기" 1회 허용. |
| 5 | **macOS: zsh와 setup.sh** | 워크스페이스 overlay는 `source install/setup.sh` (zsh 호환). `.bash`는 zsh에서 안 됨. |
| 6 | **RoboStack 채널 순서** | `conda create` 시 `-c robostack-staging -c conda-forge` 순서를 지켜야 함. 반대로 하면 conda-forge 측 패키지 우선 → ROS2 의존성 충돌. |
| 7 | **Docker는 macOS에서 3D 안 됨** | RViz/Gazebo는 Docker+XQuartz로 macOS Apple Silicon에서 Ogre/GLX 에러로 안 뜸. **확정된 제약**이니 네이티브 경로 사용. |
| 8 | **arm64 apt 저장소 한계** | Docker 이미지 빌드 시 `ros-humble-gazebo-ros-pkgs`가 arm64 apt에 없어서 `apt install` 실패하는 건 정상. Dockerfile에서 빠져 있고, Gazebo는 네이티브로 사용. |
| 9 | **포트 충돌** | 8090 / 9091 / 4840 / 9090(rosbridge)이 다른 프로세스에 잡혀 있으면 안 뜸. macOS: `lsof -nP -iTCP -sTCP:LISTEN \| grep <포트>`. Windows: `netstat -ano \| findstr <포트>`. |
| 10 | **conda env 이름 고정** | `activate_native.sh`가 `ros2_humble`이라는 이름을 하드코딩함. 다른 이름으로 만들었으면 스크립트 수정 필요. |

---

### B. PLC 연결 주의점

| # | 항목 | 설명 |
|---|---|---|
| 1 | **실행 순서를 반드시 지키기** | ① GX Simulator → ② 정공MES브릿지 → ③ OPC UA 어댑터 → ④ 웹 시뮬. 어댑터를 먼저 띄우면 4840 OPC UA 서버가 없어서 "OPC UA 연결 끊김" 메시지가 3초마다 반복됨. |
| 2 | **Python 3.12 강제** | `OPC UA 어댑터.command`(macOS)는 자동으로 3.12를 찾아쓰지만, `OPC UA 어댑터.bat`(Windows)는 그냥 `python`을 씀. 시스템 기본이 3.13/3.14면 venv가 그걸로 만들어져서 asyncua가 런타임에 깨짐. → **B단계 4번처럼 Python 3.12를 명시적으로 설치**하고, venv를 한 번 수동으로 3.12로 만들어두면 안전. |
| 3 | **방화벽 포트 3개** | 4840(OPC UA), 8090(웹), 9091(WS 어댑터) 모두 허용. 사내 보안 정책으로 차단되어 있으면 어댑터가 띄워지긴 해도 브라우저 측에서 9091에 못 붙어서 "PLC 미연결" 표시. |
| 4 | **OPC UA 엔드포인트 경로 정확히** | `opc.tcp://127.0.0.1:4840/smartfactory/server/` — 끝의 `/server/` 슬래시까지 일치해야 함. 정공MES브릿지 버전이 바뀌면서 엔드포인트가 다르면 `web/opcua_ws_adapter.py:33`의 `OPCUA_ENDPOINT` 수정. |
| 5 | **태그 카탈로그 매칭** | 어댑터는 `Sensors`/`Actuators` 폴더 아래의 변수명만 인식 (`Conv1`, `SupplyDetect` 등). 브릿지 측 변수명이 다르면 `TAG_CATALOG`에 없는 것은 무시되니 콘솔에 `discovered N/M tags` 로그로 매핑 확인. |
| 6 | **read/write 방향 구분** | `Y` 비트(`Conv1`~`Conv6`, `Robot1`~`Robot3`, `Buzzer`, `SupplyCylinder`, `Elevator`)는 **PLC가 쓰고 브라우저가 읽기**. `X` 비트(`EmergencyStop`, `SupplyDetect`, `VisionDetect`)는 **브라우저가 쓰고 PLC가 읽기**. 방향이 반대면 어댑터가 거부함. |
| 7 | **폴링 주기 50ms** | `POLL_MS = 50` (~20Hz). 빠르게 토글되는 비트는 놓칠 수 있음. 정밀이 필요하면 `web/opcua_ws_adapter.py:36`에서 줄이되, OPC UA 서버 부하 증가 주의. |
| 8 | **자동 재연결 동작** | 정공MES브릿지를 껐다가 다시 켜도 어댑터는 3초 간격으로 자동 재연결. 단, **브라우저는 WS 9091이 끊기면 자동으로 안 붙음** → 페이지 새로고침. |
| 9 | **GX Works2 모니터 ↔ 시뮬 동기화 검증** | Y0030 ON/OFF를 GX Works2 모니터에서 강제하고 → 웹 시뮬 컨베이어가 즉시 반응하는지 확인. 안 되면 ① 어댑터 콘솔 로그에 `update Conv1` 메시지가 뜨는지, ② 브라우저 콘솔에 WS 메시지가 들어오는지 차례로 격리. |
| 10 | **여러 클라이언트 동시 접속** | 어댑터는 N개의 브라우저 동시 연결 OK. 단 모두 같은 PLC 상태를 공유하므로, 한 브라우저에서 `EmergencyStop=true` 쓰면 다른 브라우저에도 즉시 반영됨 (정상 동작). |
| 11 | **캐시로 인한 코드 미반영** | 시뮬 코드 수정 시 브라우저에서 `Ctrl+Shift+R` (하드 리로드). `serve.py`는 이미 `Cache-Control: no-cache` 헤더를 보내지만 브라우저 측 SW/디스크 캐시가 먼저 잡힐 수 있음. |

---

## 🚀 사용법

> 본인이 쓰려는 트랙으로 바로 점프하세요. 트랙끼리는 **독립적**이고 동시에 켜둘 수도 있습니다.
>
> | 목적 | 트랙 |
> |---|---|
> | 로봇 코드 짜고 시각화만 보고 싶다 | **[1] 웹 시뮬 단독](#1️⃣-웹-시뮬-단독-사용법)** |
> | PLC 래더로 컨베이어/로봇을 토글하고 싶다 | **[2] 웹 시뮬 + PLC 연동](#2️⃣-웹-시뮬--plc-연동-사용법)** |
> | RViz/Gazebo로 정식 ROS2 시뮬 돌리고 싶다 | **[3] 네이티브 ROS2 런처](#3️⃣-네이티브-ros2-rvizgazebo-사용법)** |
> | 재현 가능한 ROS2 환경 (CI/실험용) | **[4] Docker 컨테이너](#4️⃣-docker-ros2-사용법)** |

---

## 1️⃣ 웹 시뮬 단독 사용법

> 🎯 **이게 가장 쉽고, 90%의 사용 케이스를 커버합니다.** 추가 설치도 거의 없음.
>
> 🤖 로봇 조작만 빠르게 보려면 → **[web/로봇_사용법.md](web/로봇_사용법.md)**
> (관절/IK 조작 + 디지털 트윈 테스트 패널 + 시나리오 테스트 버튼 + 실제 로봇 연동)

### 1-1. 시작하기 (30초)

| OS | 방법 |
|---|---|
| **macOS** | Finder에서 `웹 시뮬.command` **더블클릭** |
| **Windows** | 탐색기에서 `웹 시뮬.bat` **더블클릭** |
| **수동 실행** | 터미널에서 `cd web && python3 serve.py 8090` → 브라우저로 `http://localhost:8090` |

서버 부팅 메시지가 콘솔에 뜨고, 약 1.5초 뒤 브라우저가 자동으로 열립니다.

```
Serving /Users/.../DockerRos/web at http://localhost:8090
Ctrl+C to stop.
```

> 종료: 콘솔 창에서 `Ctrl+C` 또는 창 닫기.

### 1-2. UI 한눈에 보기

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ① 상단 툴바  [+컨베이어][+엘리베이터][+실린더] ··· [🏭 시나리오] [▶ 전체 실행] │
├────────────────────────────────────────────────────────┬─────────────────┤
│                                                        │ ④ 우측 패널     │
│                                                        │  - 로봇 추가/제거│
│                                                        │  - 카메라 프리셋 │
│       ② 3D 뷰포트 (Three.js)                          │  - Mode (수동/IK)│
│                                                        │  - 툴 선택       │
│                                                        │  - 트레일 ON/OFF │
│                                                        │  - ROS2/PLC 연결 │
│                                                        │  - 관절 슬라이더 │
├────────────────────────────────────────────────────────┤                  │
│ ③ 인스펙터 (오브젝트 클릭하면 우측에 슬라이드 인)        │                  │
└────────────────────────────────────────────────────────┴─────────────────┘
```

### 1-3. 카메라 조작

| 동작 | 단축키 / 마우스 |
|---|---|
| 시점 회전 | 좌클릭 드래그 |
| 줌 인/아웃 | 마우스 휠 |
| 카메라 팬 (이동) | 우클릭 드래그 |
| 프리셋 시점 | 우측 패널 → `ISO` / `Top` / `Front` / `Side` |
| 선택 오브젝트로 초점 | `F` 키 또는 더블클릭 → "초점 이동 (F)" |
| 좌표축 화살표 표시 | 상단 `🧭 축 표시` 토글 |

### 1-4. 로봇 추가하기

```
1) 우측 패널 → [추가할 로봇 타입] 드롭다운
   ─ Indy7 / Indy12 / UR5e / UR10e / Panda / Fanuc
2) [+ 로봇 추가] 버튼
3) 씬 로봇 목록에 추가됨 → 클릭하면 "활성 로봇"이 됨
4) 제거할 때는 [− 제거] (현재 활성 로봇 삭제)
```

### 1-5. 로봇 조작 — 두 가지 모드

#### A. **수동 모드 (슬라이더)** — 관절 직접 제어

```
우측 패널 → Mode: [수동 (슬라이더)]
↓
하단 "관절" 영역에 슬라이더 6~7개 (DOF만큼)
↓
드래그 = 관절 회전 → 3D 뷰에 즉시 반영
```

빠른 자세 프리셋:
- **🏠 Home 자세** — 작업 준비 자세 (`-π/2 C-shape`, 그리퍼 down)
- **⊙ 영점 자세** — 모든 관절 0° (URDF 영점, 팔 쭉 뻗음)

#### B. **IK 모드 (드래그)** — 끝점 위치만 지정

```
우측 패널 → Mode: [IK (드래그)]
↓
3D 뷰에서 로봇 끝점 (그리퍼)을 마우스로 잡고 드래그
↓
역기구학(IK)이 관절각을 자동 계산 → 자연스러운 자세로 이동
```

> IK 안 풀리는 위치(unreachable)에 가져가면 가장 가까운 도달 가능 자세로 수렴.

### 1-6. 툴 (그리퍼 / 펜)

```
우측 패널 → 툴 (End-effector) → 도구 선택
  ─ 없음 (맨 손)
  ─ 그리퍼  → 아래에 [opening] 슬라이더 (0 ~ 0.08 m)
  ─ 펜      → 끝점이 지나간 자리에 곡선이 그려짐 (드로잉 모드)
```

### 1-7. 시나리오 — 3-로봇 소켓 분류 라인

상단 툴바 `🏭 시나리오 로드` 클릭 → 한 번에 자동 배치됩니다.

```
                                 컨베이어 흐름 →

   [Robot1 공급]            [Robot2 검사]            [Robot3 무게/적재]
   ┌──────────┐             ┌──────────┐             ┌──────────┐
   │  매거진   │             │ DefectCam│             │  Scale   │
   │ 8핀 12핀 │  Conv1     │   ↓      │  Conv2     │ 0/0g     │  Conv3
   │  10/10   │ ─────────► │   ?      │ ─────────► │ 보관함   │ ─────►
   └──────────┘  (Y030)     └──────────┘  (Y031)     └──────────┘  (Y032)
        Robot1                  Robot2                   Robot3
        (Y040)                  (Y041)                   (Y042)
```

| 로봇 | 역할 | 핵심 동작 |
|---|---|---|
| **Robot1** (좌) | 공급 | 매거진(8핀/12핀)에서 1개 집어 Conv1 위에 올림 |
| **Robot2** (중) | 검사 | DefectCam이 불량 감지하면 Conv2 측면으로 분류 |
| **Robot3** (우) | 무게/적재 | Scale 위에서 무게 측정 → 우측 보관함에 적재 |

### 1-8. 주문 흘려보기

```
1) 상단 [📋 주문 패널] 토글 → 우측에 입력창 슬라이드 인
2) [8핀] [12핀] 개수 입력 (예: 3 / 2)
3) [+ 주문 넣기] 버튼
   → "대기 중" 리스트에 ORDER-XXXX 추가
4) Robot1이 매거진에서 해당 개수만큼 픽 → Conv1로 공급
5) 완료된 주문은 "완료 (최근 10)" 리스트로 이동
```

자동 데모: 상단 `🎲 자동 테스트` → 랜덤 주문이 무한히 흘러갑니다. 다시 누르면 정지.

### 1-9. 추가 오브젝트 (상단 툴바)

| 버튼 | 오브젝트 | 사용처 |
|---|---|---|
| 컨베이어 | `ConveyorBelt` | 박스 이송 라인 |
| 엘리베이터 | `VerticalConveyor` | 층간 수직 이송 |
| 실린더 | `Cylinder` | 매거진 푸시, 분류 게이트 |
| 테이블 | `Table` | 작업 표면 |
| 보관함 | `StorageBox` | 완제품 적재 (`0/20` 카운터) |
| 8핀 / 12핀 | `Socket8` / `Socket12` | 주문 단위 부품 |
| 센서 | `Sensor` | 통과/도착 감지 |
| 비전 | `VisionCamera` | 불량 검출 시뮬 |
| 저울 | `WeightScale` | 무게 측정 (`0/0g` 표시) |

씬에 놓인 오브젝트를 **클릭하면 인스펙터** (좌하단 슬라이드)가 열려 파라미터를 실시간 편집할 수 있습니다.

### 1-10. 경로 트레일

```
우측 패널 → 경로 트레일 → [📍 트레일 OFF] 토글
↓
활성 로봇의 끝점 위치가 색깔 곡선으로 누적됨
[🗑️ 지우기] 버튼으로 트레일 초기화
```

### 1-11. ROS2 실시간 동기화 (선택)

웹 시뮬의 관절 상태를 실제 ROS2 토픽 `/joint_states`에 publish/subscribe 하고 싶을 때.

```bash
# 1) 별도 터미널에서 rosbridge 띄우기
./ROS2\ 브릿지.command         # macOS — ws://localhost:9090

# 2) 브라우저: 우측 패널 → ROS2 실시간 → [연결]
# 3) 상태창에 "✓ 연결됨" 뜨면 OK
```

| 방향 | 동작 |
|---|---|
| 시뮬 → ROS2 | 웹에서 슬라이더로 관절 움직이면 `/joint_states`에 publish |
| ROS2 → 시뮬 | 다른 노드가 `/joint_states`에 publish하면 웹 로봇이 따라 움직임 |

### 1-12. 단축키 모음

| 키 | 동작 |
|---|---|
| `F` | 선택 오브젝트로 초점 이동 |
| 더블클릭 | 클릭한 오브젝트로 초점 |
| `Ctrl/Cmd + Shift + R` | 브라우저 하드 리로드 (캐시 무시) |
| `Esc` | 인스펙터 / 패널 닫기 |

---

## 2️⃣ 웹 시뮬 + PLC 연동 사용법

> 🏭 **GX Works2에서 작성한 래더 로직으로 웹 시뮬의 컨베이어/로봇을 토글**합니다. 반대로 웹 시뮬의 센서/비전이 켜지면 PLC의 X 비트가 ON 되어 래더가 반응합니다.

### 2-1. 전체 데이터 흐름

```
   ┌──────────┐  래더    ┌─────────────┐  가상 PLC  ┌──────────────┐  OPC UA   ┌────────────┐  WebSocket  ┌──────────┐
   │ GX Works2│ ───────► │ GX Simulator│ ────────► │ 정공MES브릿지│ ────────► │OPC UA 어댑터│ ─────────► │ 웹 시뮬   │
   │  (편집)  │          │  (가상실행) │           │ (4840 서버)  │           │  (이 저장소) │            │ (브라우저)│
   └──────────┘          └─────────────┘           └──────────────┘  ◄────────└────────────┘            └──────────┘
                                                                       태그값 폴링 50ms        WS 9091
                                                   ◄─────────────────────────────────────────────────
                                                                  X 비트 (브라우저 → PLC)
```

| 컴포넌트 | 포트 | 역할 |
|---|---|---|
| 정공MES브릿지 | **4840** (OPC UA) | GX Sim ↔ OPC UA 변환 |
| OPC UA 어댑터 | **9091** (WebSocket) | OPC UA ↔ 브라우저 변환 |
| 웹 시뮬 | **8090** (HTTP) | 정적 파일 서버 |

### 2-2. 사전 준비

설치는 끝났다고 가정 ([설치 가이드 → B](#-b-plc-연동--windows-권장) 참조). 매번 PC 켤 때마다 아래 4단계를 순서대로:

### 2-3. 단계별 실행 (Windows 기준)

**Step 1 — GX Simulator 켜기**

```
GX Works2 실행 → 프로젝트 열기 → [디버그] → [GX Simulator2/3 시작]
↓
래더 모니터링 화면이 뜨면서 시뮬레이터 가동
```

**Step 2 — 정공MES브릿지 실행**

```
정공MES브릿지 폴더 → run_bridge.bat (또는 패키징된 exe) 더블클릭
↓
콘솔에 "OPC UA server listening on opc.tcp://127.0.0.1:4840/smartfactory/server/" 메시지 확인
```

**Step 3 — OPC UA 어댑터 실행**

```
DockerRos 폴더 → [OPC UA 어댑터.bat] 더블클릭
↓
첫 실행 시: web\opcua_venv\ 자동 생성 + asyncua/websockets 설치 (1~2분, 한 번만)
↓
콘솔에 다음 메시지가 뜨면 OK:
   ✓ OPC UA connected: opc.tcp://127.0.0.1:4840/smartfactory/server/
   discovered 14/14 tags: ['Buzzer', 'Conv1', 'Conv2', ...]
   ✓ WS listening on ws://127.0.0.1:9091
```

**Step 4 — 웹 시뮬 실행**

```
DockerRos 폴더 → [웹 시뮬.bat] 더블클릭
↓
브라우저가 http://localhost:8090 자동 오픈
↓
우측 패널 하단 "OPC UA (PLC 연동)" 항목 확인:
   ✓ 연결됨 — 14개 태그
```

> macOS도 동일한 순서. `.bat` 대신 `.command` 파일을 더블클릭하면 됩니다.

### 2-4. 태그 매핑표 (전체 14개)

#### 📥 PLC가 쓰고 → 웹 시뮬이 읽기 (Y 비트, "actuator")

| 태그 이름 | PLC 주소 | 시뮬 측 동작 |
|---|---|---|
| `SupplyCylinder` | **Y020** | 공급 실린더 1회 스트로크 (매거진에서 박스 1개 푸시) |
| `Buzzer` | **Y025** | 부저 사운드 + 깜빡임 |
| `Conv1` | **Y030** | 컨베이어 1 가동/정지 (Robot1 출력단) |
| `Conv2` | **Y031** | 컨베이어 2 가동/정지 (검사 라인) |
| `Conv3` | **Y032** | 컨베이어 3 가동/정지 (적재 라인) |
| `Conv4` | **Y033** | 예비 컨베이어 4 |
| `Conv5` | **Y034** | 예비 컨베이어 5 |
| `Conv6` | **Y035** | 예비 컨베이어 6 |
| `Robot1` | **Y040** | Robot1 사이클 시작 (공급) |
| `Robot2` | **Y041** | Robot2 사이클 시작 (검사) |
| `Robot3` | **Y042** | Robot3 사이클 시작 (적재) |
| `Elevator` | **Y050** | 엘리베이터 상승/하강 |

#### 📤 웹 시뮬이 쓰고 → PLC가 읽기 (X 비트, "sensor")

| 태그 이름 | PLC 주소 | 시뮬 측 트리거 |
|---|---|---|
| `EmergencyStop` | **X010** | 우측 패널 비상 정지 버튼 |
| `SupplyDetect` | **X020** | 매거진 센서가 박스 감지 |
| `VisionDetect` | **X021** | 비전 카메라가 불량 감지 |

> 폴링 주기 **50ms (~20Hz)**. 어댑터가 OPC UA 서버 끊김을 감지하면 **3초**마다 자동 재연결.

### 2-5. 동작 검증 (가장 빠른 한 줄 테스트)

```
1) GX Works2 모니터에서 [Y0030] 디바이스를 강제 ON
2) 웹 시뮬의 Conv1 컨베이어가 즉시 회전 시작 → OK
3) 다시 강제 OFF → 컨베이어 정지

반대 방향:
4) 웹 시뮬에서 매거진 센서 클릭 → SupplyDetect 패널에서 ON 토글
5) GX Works2 모니터에서 [X0020] 디바이스가 ON으로 변하면 OK
```

### 2-6. 시나리오 + PLC 연동

`🏭 시나리오 로드`로 3-로봇 라인을 깔면, **각 컨베이어/실린더/센서가 자동으로 Y/X 태그에 바인딩**됩니다. 따로 매핑할 필요 없음.

```
래더 예시 — Robot1 공급 사이클:

    ┌─[X020]──────────────────────────[T0 K10]─┐  공급 감지 후 1초 대기
    │                                           │
    └─[T0]────[Y020]────────────────────────────┘  공급 실린더 1펄스

    ┌─[X020]──[NOT M0]─────────────────[Y030]──┐  컨베이어 가동
    │                                           │
    └─[X021]────────────────────────────[M0]───┘  비전 OFF로 정지
```

이 래더를 GX Sim에 넣고 → 웹 시뮬에서 매거진 센서를 켜면 → **자동으로 Y020(실린더) 펄스 → Y030(컨베이어) 가동 → 박스가 흘러감**.

### 2-7. 디버깅 (잘 안될 때)

| 증상 | 격리 단계 |
|---|---|
| 어댑터 콘솔에 `OPC UA 연결 끊김` 반복 | ① 정공MES브릿지 떠있나 ② 4840 포트 방화벽 ③ 엔드포인트 경로 (`/server/` 끝슬래시) |
| 어댑터는 OK인데 브라우저에 "OPC UA 미연결" | ① 9091 포트 방화벽 ② 브라우저 콘솔에 WS 에러? ③ `web/src/domains/connectivity/opcua/OpcuaClient.js` 의 WS URL 확인 (`web/opcua-client.js`는 호환 wrapper) |
| 어댑터 콘솔에 `discovered 0/14 tags` | 정공MES브릿지가 `Sensors`/`Actuators` 폴더 구조로 변수 노출 안 함 — 브릿지 버전/설정 확인 |
| Y0030 토글해도 컨베이어 안 돌아감 | ① 어댑터 콘솔에 `update Conv1 = True` 로그 뜨나 ② 브라우저 개발자도구 Network → WS 메시지 도착하나 ③ 시나리오 로드했나 (안 했으면 바인딩 없음) |
| X 비트 써도 PLC 측에 안 뜸 | 해당 태그가 `direction: "write"`로 등록됐는지 어댑터 카탈로그 확인 |

> 자세한 트러블슈팅은 [⚠️ B. PLC 연결 주의점](#b-plc-연결-주의점) 참조.

---

## 3️⃣ 네이티브 ROS2 (RViz/Gazebo) 사용법

> 🍎 **macOS 전용**. RoboStack(conda) 환경이 깔려 있어야 합니다 ([설치 → C](#-c-네이티브-ros2-rviz--gazebo--macos-전용)).

### 3-1. 한 줄 요약

```
DockerRos 폴더의 .command 파일을 Finder에서 더블클릭하면 끝.
```

각 `.command`는 내부적으로 `scripts/_common.sh` → `conda activate ros2_humble` + 워크스페이스 overlay + XQuartz 부팅까지 자동 처리합니다.

### 3-2. 더블클릭 런처 카탈로그

#### 🦾 로봇 팔 (RViz 슬라이더 뷰어)

| 런처 | 로봇 | 출력 |
|---|---|---|
| `Indy7 팔 뷰어.command` | Neuromeka Indy7 (6DOF) | RViz + joint_state_publisher_gui (슬라이더 6개) |
| `Indy12 팔 뷰어.command` | Neuromeka Indy12 (6DOF) | 동일 |
| `UR5 팔 뷰어.command` | UR5e (6DOF) | 동일 |
| `Panda 팔 뷰어.command` | Franka Panda (7DOF) | 동일 |
| `Fanuc 팔 뷰어.command` | Fanuc M-10iA (6DOF) | 동일 |

#### 🤖 로봇 팔 (Gazebo + MoveIt2 정식 시뮬)

| 런처 | 로봇 | 동작 |
|---|---|---|
| `UR5 팔 시뮬.command` | UR5e | Gazebo Fortress + MoveIt2. RViz에서 녹색 골 드래그 → Plan & Execute |
| `UR10 팔 시뮬.command` | UR10e | 동일 |

#### 🚗 모바일 로봇

| 런처 | 환경 |
|---|---|
| `TurtleBot3 월드.command` | TurtleBot3 + `turtlebot3_world` (실린더 + 박스 장애물) |
| `TurtleBot3 집.command` | TurtleBot3 + `turtlebot3_house` (아파트 환경) |
| `키보드조종.command` | 텔레옵 — `w/x` 전후, `a/d` 회전, `s` 정지 |

> TurtleBot3 모델 변경: 셸에서 `export TURTLEBOT3_MODEL=waffle_pi` 후 런처 실행.

#### 🛠️ 보조

| 런처 | 동작 |
|---|---|
| `Gazebo.command` | Gazebo Classic 11 빈 월드 단독 실행 |
| `RViz2.command` | RViz2 단독 실행 |
| `ROS셸.command` | ROS2 환경이 활성화된 인터랙티브 셸 (`ros2`, `colcon`, `rviz2` 사용 가능) |
| `GUI테스트.command` | xeyes (X11 점검용) — XQuartz가 정상이면 눈 두 개 창이 뜸 |
| `ROS2 브릿지.command` | rosbridge_server 실행 (`ws://localhost:9090`) — 웹 시뮬의 ROS2 연결과 짝 |

### 3-3. 셸에서 직접 쓰는 법

```bash
# 환경 활성화 (한 번)
source ./activate_native.sh

# 예제: hello_ros2 패키지 talker
ros2 run hello_ros2 talker          # 한 터미널
ros2 run hello_ros2 listener        # 다른 터미널

# 예제: Indy7 (xacro 처리, 메시 경로 자동 해결)
ros2 launch robot_viewer view.launch.py \
    urdf:=$DOCKEROS_ROOT/ros2_ws/install/indy_description/share/indy_description/urdf/indy.urdf.xacro \
    xacro_args:="name:=indy indy_type:=indy7"

# 예제: UR5e + Gazebo Fortress + MoveIt2
ros2 launch ur_simulation_gz ur_sim_moveit.launch.py ur_type:=ur5e

# 예제: TurtleBot3 (모델 변경 가능)
export TURTLEBOT3_MODEL=waffle_pi
ros2 launch turtlebot3_gazebo turtlebot3_world.launch.py
```

### 3-4. 새 패키지 빌드/추가하기

```bash
source ./activate_native.sh
cd ros2_ws

# 새 패키지 만들기 (ament_python 예)
ros2 pkg create --build-type ament_python --license MIT my_pkg

# 빌드 (선택적)
colcon build --packages-select my_pkg

# 워크스페이스 overlay 다시 source
source install/setup.sh

# 실행
ros2 run my_pkg my_node
```

> `hello_ros2` 패키지가 미니멀 pub/sub 템플릿입니다. 새 패키지 만들 때 구조 참고하세요.

### 3-5. RViz/Gazebo 사용 팁

| 항목 | 팁 |
|---|---|
| 창이 안 보임 | macOS Dock에서 **XQuartz 아이콘 클릭** 또는 `Cmd+Tab`으로 XQuartz 전환 |
| 모델이 와이어프레임만 보임 | xacro 처리가 빠진 것 — `view-robot-viewer.sh`처럼 xacro 인자 전달 |
| 슬라이더 윈도우와 RViz가 따로 뜸 | 정상. 슬라이더에서 관절 움직이면 RViz 모델이 실시간으로 따라옴 |
| MoveIt Plan & Execute | RViz 좌측 패널 `MotionPlanning` → 녹색 공 드래그 → `Plan` → `Execute` |

---

## 4️⃣ Docker ROS2 사용법

> 🐳 **재현 가능 환경 / CI / 클린룸 테스트용**. macOS에서 RViz·Gazebo 같은 3D GUI는 **안 뜹니다** (XQuartz + Apple Silicon 제약). 2D Qt(rqt 등)만 동작.

### 4-1. 컨테이너 라이프사이클

```bash
./run.sh build      # 이미지 빌드 (dockeros:humble, ~4.65GB, 5~10분)
./run.sh up         # 컨테이너 백그라운드 가동 (XQuartz도 자동으로 띄움)
./run.sh shell      # 컨테이너 안으로 진입 (bash)
./run.sh logs       # 컨테이너 로그 follow
./run.sh down       # 컨테이너 정지/제거
./run.sh rebuild    # 이미지 no-cache 재빌드
./run.sh gui        # 컨테이너 재시작 (DISPLAY 환경 갱신용)
```

### 4-2. 컨테이너 내부에서

```bash
# 컨테이너 진입
./run.sh shell

# ROS2 환경은 .bashrc에서 자동 source됨
ros2 run hello_ros2 talker     # 다른 셸에서 listener 띄워서 확인
ros2 topic list                # /chatter 보임

# 2D Qt — OK
rqt_graph                      # 노드 그래프
rqt                            # rqt 통합 UI

# 3D — ✗ (Ogre/GLX 에러)
# rviz2          → 안 뜸
# gazebo         → 안 뜸
```

### 4-3. 호스트 ↔ 컨테이너 코드 공유

```
호스트:        ./ros2_ws/                    ← 코드 편집 (VS Code 등)
   ↕ (volume mount)
컨테이너:      /home/ros/ros2_ws/             ← 빌드 + 실행

# 호스트에서 코드 수정 → 컨테이너에서 빌드
./run.sh shell
cd /home/ros/ros2_ws
colcon build --packages-select <pkg>
source install/setup.bash      # 컨테이너 안에서는 .bash OK
```

### 4-4. 권장 사용 시나리오

- ✅ Linux 서버에서 코스워크 채점/CI
- ✅ "내 환경에서는 됐는데?" 같은 환경 격리 디버깅
- ✅ 동료에게 동일 환경 공유 (`docker compose up` 한 줄)
- ❌ macOS에서 RViz/Gazebo 일상 사용 — 네이티브 ([트랙 3](#3️⃣-네이티브-ros2-rvizgazebo-사용법))로 가세요

---

## 📑 런처 파일 빠른 참조 (cheatsheet)

| 카테고리 | 파일 | 짧은 설명 |
|---|---|---|
| **웹 시뮬** | `웹 시뮬.command` / `.bat` | 브라우저 자동 오픈 (port 8090) |
| **PLC** | `OPC UA 어댑터.command` / `.bat` | OPC UA(4840) ↔ WS(9091) |
| **Indy** | `Indy7 팔 뷰어.command` | RViz + 슬라이더 |
| | `Indy12 팔 뷰어.command` | 동일 (대형) |
| **UR** | `UR5 팔 뷰어.command` | RViz + 슬라이더 |
| | `UR5 팔 시뮬.command` | Gazebo + MoveIt2 |
| | `UR10 팔 시뮬.command` | Gazebo + MoveIt2 (대형) |
| **기타 로봇** | `Panda 팔 뷰어.command` | 7DOF Franka |
| | `Fanuc 팔 뷰어.command` | 6DOF Fanuc M-10iA |
| **TurtleBot3** | `TurtleBot3 월드.command` | 박스/실린더 월드 |
| | `TurtleBot3 집.command` | 아파트 월드 |
| | `키보드조종.command` | 텔레옵 |
| **저수준** | `Gazebo.command` | Gazebo 빈 월드 |
| | `RViz2.command` | RViz2 단독 |
| | `ROS셸.command` | ROS2 환경 셸 |
| | `GUI테스트.command` | xeyes (X11 점검) |
| | `ROS2 브릿지.command` | rosbridge_server (ws://9090) |

> Windows `.bat`은 **`웹 시뮬.bat` + `OPC UA 어댑터.bat` 2개만** 제공됩니다. ROS2 런처는 macOS RoboStack 전용. Windows에서 ROS2 필요 시 WSL2 + Ubuntu 22.04 사용.

---

## 🛠️ 기타 트러블슈팅

위 [주의점](#-주의점) 섹션에서 다루지 못한 잡다한 케이스.

| 증상 | 해결 |
|---|---|
| RViz/Gazebo가 검은 창만 뜸 (macOS) | XQuartz가 켜져 있는지 확인 → `xhost + 127.0.0.1` → `Indy7 팔 뷰어.command` 같은 네이티브 런처 사용 (Docker는 ✗) |
| `ros2: command not found` | `source ./activate_native.sh` 먼저 실행 |
| Indy 메시(visual)가 안 보임 | xacro 처리가 필요 — `run-robot-viewer.sh indy7`이 자동 처리. 직접 호출 시 `xacro_args:="name:=indy indy_type:=indy7"` 전달 |
| TurtleBot3 키보드 텔레옵 입력 안 먹음 | 텔레옵 띄운 터미널에 **포커스**가 가 있어야 함. XQuartz 윈도우는 입력 안 받음 |
| Windows 콘솔에서 한글 깨짐 | `.bat` 첫 줄에 `chcp 65001` 이미 들어 있음. 그래도 깨지면 Windows Terminal 사용 권장 |
| 자세한 Windows 절차 | [Windows 실행 안내.txt](Windows%20실행%20안내.txt) 참조 |

---

## 📝 라이선스 / 출처

- [Neuromeka indy-ros2](https://github.com/neuromeka-robotics/indy-ros2)
- [Universal Robots ROS2 description](https://github.com/UniversalRobots/Universal_Robots_ROS2_Description)
- [Franka panda_description](https://github.com/frankaemika/franka_ros)
- [Fanuc fanuc_description](https://github.com/ros-industrial/fanuc)
- [TurtleBot3](https://github.com/ROBOTIS-GIT/turtlebot3)
- Three.js / urdf-loader / roslib (CDN: esm.sh)

코스워크용 학습 환경입니다. 각 모델/라이브러리의 원 라이선스를 따릅니다.
