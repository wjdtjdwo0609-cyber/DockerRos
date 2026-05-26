# DDD Moduleization - DockerRos

## 현재 결론

DockerRos는 이미 1차 DDD 모듈화가 완료된 상태다. 기존 `web/*.js` 경로는 호환 wrapper로 유지하고, 실제 업무 규칙은 `web/src/domains/*` bounded context로 이동되어 있다. 상세 진행 기록은 `DDD_모듈화_진행상황.md`에 남아 있으며, 이 문서는 앱별 표준 요약 문서 역할을 한다.

## Bounded Context

### Robot Control

경로: `web/src/domains/robot-control`

- 역할: 로봇 종류, 조인트 구성, 포즈 계산, IK 계획, 로봇 인스턴스와 매니저
- 도메인 언어: `robot`, `joint`, `pose`, `tcp`, `ik`
- 핵심 파일:
  - `domain/poseMath.js`
  - `domain/robotConfig.js`
  - `application/RobotInstance.js`
  - `application/RobotManager.js`
  - `application/ikPlanner.js`

### Factory Simulation

경로: `web/src/domains/factory-simulation`

- 역할: 컨베이어, 센서, 소켓, 트레이, 저울, 비전 카메라 등 공장 설비 객체 관리
- 도메인 언어: `SimObject`, `registry`, `sensor`, `tray`, `socket`, `weighing`
- 핵심 파일:
  - `domain/SimObject.js`
  - `application/SimRegistry.js`
  - `objects/*`
  - `presentation/buildInspectorUI.js`

### Scenario Authoring

경로: `web/src/domains/scenario-authoring`

- 역할: 공장 배치, 로봇 작업 시퀀스, 트리거 이벤트 루프, 용접/작업 사이클
- 도메인 언어: `factory scenario`, `pose`, `dispense queue`, `robot choreography`
- 핵심 파일:
  - `domain/poses.js`
  - `domain/dispenseQueue.js`
  - `application/loadFactoryScenario.js`
  - `application/robotChoreography.js`
  - `application/setupRobotEventLoops.js`

### Production Flow

경로: `web/src/domains/production-flow`

- 역할: 생산 주문, 생산 수량, 주문 상태
- 도메인 언어: `Order`, `PENDING`, `RUNNING`, `DONE`
- 핵심 파일:
  - `domain/Order.js`
  - `presentation/OrderPanel.js`

### Connectivity

경로: `web/src/domains/connectivity`

- 역할: OPC UA, ROS bridge, 외부 라인 이벤트 연결
- 도메인 언어: `OPC UA`, `ROS`, `bridge`, `line event`
- 핵심 파일:
  - `opcua/OpcuaClient.js`
  - `ros/SocketPickingBridge.js`

## Composition Root

`web/app.js`는 여전히 가장 큰 composition root다. 다만 핵심 도메인 규칙은 `web/src/domains` 아래로 빠져 있고, `web/src/app/*`는 카메라, 키보드 팬, ROS mirror 같은 앱 조립 헬퍼를 담당한다.

## 호환성

기존 import와 실행 경로는 유지된다.

- `web/robot.js`
- `web/scenarios.js`
- `web/sim-objects.js`
- `web/order-panel.js`
- `web/opcua-client.js`
- `web/socket_picking_bridge.js`

새 코드가 외부에서 가져다 쓸 때는 `web/src/public-api/index.js`를 단일 진입점으로 사용한다.

## 검증

- `./web/tests/run.sh`
  - 순수 도메인 테스트 대상: 주문, 로봇 설정, IK pose unwrap
