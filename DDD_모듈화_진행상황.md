# DockerRos DDD 모듈화 진행상황

## 목표

DockerRos 웹 시뮬레이터를 스마트 팩토리 대시보드나 다른 웹 앱에서 안전하게 가져다 쓸 수 있도록, 기존 god module 구조를 DDD bounded context 단위로 점진 분리한다.

기본 원칙은 다음과 같다.

- 기존 `web/index.html` 실행 경로는 유지한다.
- 외부에서 가져다 쓸 때는 `web/src/public-api/index.js`를 통해 import한다.
- 기존 `web/robot.js`, `web/scenarios.js` 같은 경로는 호환 wrapper로 남긴다.
- 한 번에 내부 로직을 갈아엎지 않고, 먼저 파일 소속과 공개 API를 정리한 뒤 도메인 로직을 더 작게 분리한다.

## 1차 분리 결과

```txt
web/
  app.js                              # 브라우저 조립부
  robot.js                            # 기존 경로 호환 wrapper
  sim-objects.js                      # 기존 경로 호환 wrapper
  scenarios.js                        # 기존 경로 호환 wrapper
  opcua-client.js                     # 기존 경로 호환 wrapper
  order-panel.js                      # 기존 경로 호환 wrapper
  trail.js                            # 기존 경로 호환 wrapper
  socket_picking_bridge.js            # 기존 경로 호환 side-effect wrapper

  src/
    app/
      installBrowserErrorReporter.js

    shared/
      events/
        EventBus.js

    domains/
      robot-control/
        application/
          RobotInstance.js
          RobotManager.js
        domain/
          ikPlanner.js
          robotConfig.js
        infrastructure/
          three/
            toolMeshes.js
        RobotManager.js
        index.js

      factory-simulation/
        application/
          SimRegistry.js
        catalog/
          simObjectTypes.js
        domain/
          SimObject.js
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

      scenario-authoring/
        FactoryScenario.js
        index.js

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
      index.js
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

생활 예시로 보면 공장 안의 “로봇 운전팀”이다. 컨베이어가 무엇을 싣고 있는지, 주문이 어디서 왔는지는 몰라도 된다. 로봇 팔을 어떻게 움직일지만 책임진다.

현재 `ikPlanner.js`에는 TCP 목표점으로 조인트 각도를 계산하는 오프라인 IK 계획 함수가 분리되어 있다. `RobotInstance.js`는 로봇 한 대의 조인트/포즈/툴/픽업 상태를 담당하고, `RobotManager.js`는 여러 로봇의 로딩/선택/삭제와 base gizmo를 담당한다. `toolMeshes.js`는 그리퍼와 펜 같은 Three.js 툴 메쉬 생성만 맡는다. 루트의 `RobotManager.js`는 기존 import 호환을 위한 barrel export로 남았다.

### factory-simulation

컨베이어, 센서, 실린더, 트레이, 소켓, 저울, 비전 카메라 같은 시뮬레이션 객체를 담당한다.

생활 예시로 보면 “설비팀”이다. 설비가 켜졌는지, 센서가 감지했는지, 저울이 몇 g을 읽었는지를 관리한다.

현재 `SimObject.js`는 모든 설비 객체가 공유하는 기본 상태와 dispose 규칙을 담당한다. `SimObjects.js`는 실제 설비 객체 구현을 담고, `SimRegistry.js`는 화면 선택/삭제/OPC UA 동기화/인스펙터 연결을 담당한다. `buildInspectorUI.js`는 DOM 기반 인스펙터 렌더링만 맡는다.

추가 분리 후에는 실제 설비 구현도 `objects/` 하위로 나뉜다. `conveyors.js`는 컨베이어/실린더/센서/엘리베이터, `sockets.js`는 8핀/12핀 소켓과 컨베이어 탑승 로직, `trays.js`는 트레이와 트레이 매거진, `storage.js`는 테이블/보관함, `inspection.js`는 비전 카메라, `weighing.js`는 저울을 담당한다. `SimObjects.js`는 기존 import 호환을 위한 barrel export로 남았다.

### production-flow

주문, 생산 수량, 완료 처리 같은 생산 흐름을 담당한다.

생활 예시로 보면 “생산관리팀”이다. 8핀 몇 개, 12핀 몇 개를 만들어야 하는지 관리한다.

### scenario-authoring

공장 배치와 데모 작업 순서를 담당한다.

생활 예시로 보면 “공장 배치 설계자”다. 로봇과 설비를 어디에 놓고 어떤 순서로 움직일지 정의한다.

### connectivity

OPC UA, ROS bridge, 실제 라인 이벤트 같은 외부 연결을 담당한다.

생활 예시로 보면 “통신팀”이다. PLC, ROS, 웹 대시보드에서 오는 신호를 받아 내부 모듈이 이해할 수 있는 이벤트로 넘긴다.

## 다음 분리 대상

1. `factory-simulation/SimObjects.js`
   - `SimObject` 기본 모델, `SimRegistry`, inspector UI, 설비 객체 종류별 파일 분리가 완료됐다.
   - 다음 단계에서는 각 설비 객체 내부의 Three.js mesh 생성 함수를 `infrastructure/three` 쪽으로 더 밀어낼 수 있다.

2. `robot-control/RobotManager.js`
   - IK 계획, 로봇 config, 툴 메쉬, 로봇 인스턴스, 로봇 매니저 분리가 완료됐다.
   - 다음 단계에서는 URDF 로딩 어댑터와 로봇 선택 highlight/gizmo 코드를 `infrastructure/three`로 더 분리할 수 있다.

3. `scenario-authoring/FactoryScenario.js`
   - 현재 시나리오 정의, 생산 흐름, 로봇 choreography, feeder queue가 섞여 있다.
   - 다음 단계에서 layout blueprint, robot task, production workflow를 분리한다.

4. `app.js`
   - 현재 브라우저 조립부이지만 아직 DOM, Three.js, ROS sync, UI command가 많다.
   - 최종 목표는 `app.js`를 100~150줄 수준의 composition root로 줄이는 것이다.

## 현재 상태

1차 작업은 “경계 만들기” 단계다. 아직 대형 파일 내부를 완전히 쪼개지는 않았다. 대신 import 가능한 공개 API와 DDD 디렉터리 구조를 먼저 잡았기 때문에, 이후 작업은 기존 화면을 깨뜨릴 위험을 낮추면서 한 모듈씩 진행할 수 있다.
