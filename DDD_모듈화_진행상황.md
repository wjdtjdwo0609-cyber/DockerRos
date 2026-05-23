# DockerRos DDD 모듈화 진행상황

## 목표

DockerRos 웹 시뮬레이터를 스마트 팩토리 대시보드나 다른 웹 앱에서 안전하게 가져다 쓸 수 있도록, 기존 god module 구조를 DDD bounded context 단위로 점진 분리한다.

기본 원칙은 다음과 같다.

- 기존 `web/index.html` 실행 경로는 유지한다.
- 외부에서 가져다 쓸 때는 `web/src/public-api/index.js`를 통해 import한다.
- 기존 `web/robot.js`, `web/scenarios.js` 같은 경로는 호환 wrapper로 남긴다.
- 한 번에 내부 로직을 갈아엎지 않고, 먼저 파일 소속과 공개 API를 정리한 뒤 도메인 로직을 더 작게 분리한다.

## 현재 트리

```txt
web/
  app.js                              # 908줄 — composition root (분할 대상, 아래 참고)
  robot.js                            # 기존 경로 호환 wrapper
  sim-objects.js                      # 기존 경로 호환 wrapper
  scenarios.js                        # 기존 경로 호환 wrapper
  opcua-client.js                     # 기존 경로 호환 wrapper
  order-panel.js                      # 기존 경로 호환 wrapper
  trail.js                            # 기존 경로 호환 wrapper
  socket_picking_bridge.js            # 기존 경로 호환 side-effect wrapper

  tests/                              # node:test 16개 (순수 도메인만)
    order.test.js
    robotConfig.test.js
    ikPlanner.unwrapPose.test.js
    run.sh                            # `./web/tests/run.sh` 로 실행

  src/
    app/                              # composition-root helpers (도메인 X)
      installBrowserErrorReporter.js
      cameraControls.js               # createCameraControls({camera, orbit})
      keyboardPan.js                  # installKeyboardPan({camera, orbit, isCameraAnimating})
      rosJointMirror.js               # createRosJointMirror({robotManager})
      index.js

    domains/
      robot-control/
        application/
          RobotInstance.js
          RobotManager.js
          ikPlanner.js                # CCD IK — THREE/URDF 의존이라 application
        domain/
          poseMath.js                 # 순수 함수 (테스트 가능, no THREE)
          robotConfig.js
        infrastructure/
          three/
            toolMeshes.js
        RobotManager.js               # 기존 경로 호환 barrel
        index.js

      factory-simulation/
        application/
          SimRegistry.js
        catalog/
          simObjectTypes.js
        domain/
          SimObject.js                # base class (THREE.Group — 아래 trade-off 참고)
        objects/
          conveyors.js
          inspection.js
          sockets.js
          storage.js
          trays.js
          weighing.js
        presentation/
          buildInspectorUI.js
        SimObjects.js
        index.js

      scenario-authoring/              # ← 1052줄 god module 8개로 분할 완료
        domain/
          poses.js                    # HOME_POSE + 모든 POSE_* 상수
          dispenseQueue.js            # _feederState + enqueue/length/clear
        application/
          loadFactoryScenario.js      # 385줄 — 공장 layout / OPC UA wiring
          robotChoreography.js        # 364줄 — R1/R2/R3 pick-place 시퀀스
          setupRobotEventLoops.js     # 95줄 — vision/tray 트리거 이벤트 hook
          runWeldingTest.js           # 81줄 — 디버그 용접 시퀀스
          runWorkCycle.js             # 12줄 — 레거시 stub
        FactoryScenario.js            # 20줄 호환 shim (re-exports)
        index.js                      # 새 public-API barrel

      production-flow/
        domain/
          Order.js
        presentation/
          OrderPanel.js
        index.js

      connectivity/
        opcua/
          OpcuaClient.js
          index.js
        ros/
          SocketPickingBridge.js
          index.js
        index.js

    infrastructure/
      three/
        addEdgesOverlay.js
        TrailRenderer.js
        index.js

    public-api/
      index.js                        # 외부에서 쓰는 단일 진입점
```

## 공개 API 사용 예시

```js
import {
  createProductionOrder,
  RobotManager,
  SimRegistry,
  OpcuaClient,
  loadFactoryScenario,
} from './web/src/public-api/index.js';
```

기존 코드도 계속 동작한다.

```js
import { RobotManager } from './web/robot.js';
import { loadFactoryScenario } from './web/scenarios.js';
```

## bounded context 설명

### robot-control

로봇의 종류, 조인트 구성, IK 계획, 로봇 인스턴스, 로봇 매니저를 담당한다.

생활 예시로 보면 공장 안의 "로봇 운전팀"이다. 컨베이어가 무엇을 싣고 있는지, 주문이 어디서 왔는지는 몰라도 된다. 로봇 팔을 어떻게 움직일지만 책임진다.

- `domain/poseMath.js` — 조인트 각도 wrap/unwrap 순수 함수. node:test로 단위 테스트됨.
- `domain/robotConfig.js` — 지원 로봇별 joint chain + TCP 링크 이름.
- `application/ikPlanner.js` — CCD IK 솔버. THREE.Matrix4와 URDF joint 구조를 다루기 때문에 `domain/`이 아닌 `application/`에 둠.
- `application/RobotInstance.js` — 로봇 한 대의 조인트/포즈/툴/픽업 상태.
- `application/RobotManager.js` — 여러 로봇의 로딩/선택/삭제와 base gizmo.
- `infrastructure/three/toolMeshes.js` — 그리퍼/펜 같은 Three.js 툴 메쉬 생성.
- 루트의 `RobotManager.js` — 기존 import 호환을 위한 barrel.

### factory-simulation

컨베이어, 센서, 실린더, 트레이, 소켓, 저울, 비전 카메라 같은 시뮬레이션 객체를 담당한다.

생활 예시로 보면 "설비팀"이다. 설비가 켜졌는지, 센서가 감지했는지, 저울이 몇 g을 읽었는지를 관리한다.

- `domain/SimObject.js` — 모든 설비 객체가 공유하는 기본 상태 + dispose. THREE.Group을 직접 들고 있는데, 이는 *수용한 trade-off*: SimObject의 본질이 "3D 씬에 존재하는 것"이라 Three.js를 빼면 빈 클래스만 남는다.
- `application/SimRegistry.js` — 화면 선택/삭제/OPC UA 동기화/인스펙터 연결.
- `presentation/buildInspectorUI.js` — DOM 기반 인스펙터 렌더링.
- `objects/*` — 컨베이어/실린더/센서, 8핀/12핀 소켓, 트레이, 저울, 비전 카메라 등 구체 구현.
- `SimObjects.js` — 기존 import 호환용 barrel.

### scenario-authoring

공장 배치와 로봇 작업 시퀀스를 담당한다.

생활 예시로 보면 "공장 배치 설계자 + 작업 안무가"다. 로봇과 설비를 어디에 놓고 어떤 순서로 움직일지 정의한다.

- `domain/poses.js` — Indy7 6DOF의 HOME / R1·R2·R3 모든 POSE_* 상수 (pure data).
- `domain/dispenseQueue.js` — 주문 큐 + 피더 하드웨어 참조 (모듈-레벨 싱글톤).
- `application/loadFactoryScenario.js` — 공장 배치 (로봇 3대 + 컨베이어 3개 + 저울/박스/카메라/실린더) + OPC UA tag wiring.
- `application/robotChoreography.js` — R1 magazine 픽, R2 결함 reject, R3 weigh+sort, 그리고 일반 IK pick-place.
- `application/setupRobotEventLoops.js` — vision 트리거(R2), 트레이 park 트리거(R3)를 tickHook에 등록.
- `application/runWeldingTest.js` — 용접 시퀀스 디버그 도구.
- `application/runWorkCycle.js` — 레거시 stub (선이 이벤트 기반으로 바뀐 뒤 거의 비어 있음).

### production-flow

주문, 생산 수량, 완료 처리 같은 생산 흐름을 담당한다.

생활 예시로 보면 "생산관리팀"이다. 8핀 몇 개, 12핀 몇 개를 만들어야 하는지 관리한다.

- `domain/Order.js` — 주문 생성 + 상태 (PENDING/RUNNING/DONE). node:test로 단위 테스트됨.
- `presentation/OrderPanel.js` — 주문 입력 UI.

### connectivity

OPC UA, ROS bridge, 실제 라인 이벤트 같은 외부 연결을 담당한다.

생활 예시로 보면 "통신팀"이다. PLC, ROS, 웹 대시보드에서 오는 신호를 받아 내부 모듈이 이해할 수 있는 이벤트로 넘긴다.

### app/ (composition-root helpers)

도메인이 아닌, app.js가 wiring할 때만 쓰는 헬퍼들. 새로 가져다 쓰는 사람은 거의 만질 일이 없다.

- `cameraControls.js` — 카메라 프리셋(iso/top/front/side) + focus-on-selection lerp 애니메이션.
- `keyboardPan.js` — 화살표/WASD 바닥면 팬.
- `rosJointMirror.js` — `/<cid>/joint_states` 와 shared `/joint_states` 의 우선순위 정책 (실라인 mirror).
- `installBrowserErrorReporter.js` — 브라우저 콘솔 에러 캡처.

## 클린 아키텍처 레이어 규칙

```
presentation  ←──┐
application   ←──┤  도메인 안쪽으로만 import
domain        ←──┘
infrastructure (three.js, urdf-loader, rosbridge — 가장 바깥)
```

검증 결과:
- ✅ `domain → application/presentation` 역방향 의존 0건.
- ✅ `domain` 레이어 외부 의존 — `robot-control/domain` 는 이제 순수.
- ⚠️ `factory-simulation/domain/SimObject.js` 만 `three` import — 위에서 설명한 수용된 trade-off.
- ⚠️ `scenario-authoring → robot-control` 직접 import 1건 (Context Map상 Customer-Supplier로 허용 범위).

## 테스트

`node:test` 내장 러너 + 16개 테스트 (npm install 불필요).

```bash
./web/tests/run.sh         # 또는 macOS 더블클릭: 테스트.command
```

- `order.test.js` — production-flow/Order 의 createProductionOrder, hasOrderItems, ID 단조 증가.
- `robotConfig.test.js` — 지원 로봇 6종(indy7/indy12/ur5e/ur10e/panda/fanuc)의 chain/tcp shape 검증.
- `ikPlanner.unwrapPose.test.js` — poseMath의 ±π wrap, 다중 wrap, multi-joint 독립성.

브라우저 의존 코드(`loadFactoryScenario`, `planIKToTarget`, choreography)는 통합 테스트 대상이라 여기엔 없음.

## 다음 분리 대상

1. **`app.js` (908줄) — 가장 큰 진입장벽**
   - DOM refs, 씬 부트스트랩, URDF 로딩, IK transform controls, 조인트 UI, OPC UA status, 트레일/용접/주문/오토데모/디지털트윈 패널이 모두 한 파일에 있음.
   - 최종 목표는 100~150줄의 composition root. 이번 패스에서 카메라/팬/ROS 미러 3개를 빼서 1043→908줄로 줄였음.
   - 다음: 디지털트윈 테스트 패널(`syncTestPanel`, `bindTestPos`, `_spinJob`, ~80줄), 주문 데모 루프(`startOrderDemo`, `_orderDemos`, ~100줄), 용접 버튼 상태(`setWeldingButtonRunning`, ~50줄), 조인트 UI 빌더(`buildJointUI`, `refreshActivePanel`, `refreshRobotList`, ~150줄).

2. **`factory-simulation/SimObjects.js` (분리 완료)**
   - 다음 단계에서는 각 설비 객체 내부의 Three.js mesh 생성 함수를 `infrastructure/three` 쪽으로 더 밀어낼 수 있다.

3. **`robot-control` (분리 완료)**
   - URDF 로딩 어댑터, 선택 highlight/gizmo 코드를 `infrastructure/three`로 더 분리할 수 있다.

4. **(미시작) 도메인 간 event-driven 통신**
   - 현재 `scenario-authoring → robot-control` 직접 import. 진짜 DDD 정석은 도메인 이벤트(예: `RobotTaskRequested`, `SocketPickPlaced`)로 디커플링.
   - 이걸 도입한 다음에 EventBus 모듈을 다시 만들고 wire하면 된다. 지금은 dead code 피하려고 제거한 상태.

## 현재 상태

god module 분할이 한 번의 큰 패스를 끝낸 시점이다. 1차 "경계 만들기"는 이미 끝났고, 이번 패스에서 `scenario-authoring/FactoryScenario.js` (1052줄)와 `app.js` (135줄) 를 같이 잘라서 도메인 단위 파일 사이즈가 대부분 400줄 이내로 들어왔다. 가장 큰 남은 덩어리는 `app.js` (908줄) — 위 1번 참고.
