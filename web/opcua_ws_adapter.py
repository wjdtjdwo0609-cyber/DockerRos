#!/usr/bin/env python3
"""
OPC UA ↔ WebSocket adapter for the DockerRos browser robot simulator.

Bridges the smart-factory-dashboard OPC UA server (exposed by
plc_bridge/opcua_bridge.py on opc.tcp://127.0.0.1:4840) into a WebSocket
endpoint (ws://127.0.0.1:9091) that the browser sim can consume directly.

Protocol (JSON lines over WS):

  server → client
    {"type":"catalog","tags":[{"name":"Conv1","direction":"read","label":"..."}]}
    {"type":"snapshot","tags":{"Conv1":false,"Conv2":false,...}}
    {"type":"update","tag":"Conv1","value":true}
    {"type":"error","message":"..."}

  client → server
    {"type":"write","tag":"SupplyDetect","value":true}   # only for "write"-direction tags

Reads are polled every POLL_MS; writes are forwarded immediately.
Reconnects to the OPC UA server every 3s if it disappears.
"""

import asyncio
import json
import logging
import signal
from contextlib import suppress

from asyncua import Client, ua
import websockets

OPCUA_ENDPOINT = "opc.tcp://127.0.0.1:4840/smartfactory/server/"
WS_HOST = "127.0.0.1"
WS_PORT = 9091
POLL_MS = 50   # 50ms → ~20Hz, comfortably under any human-visible lag

# Friendly catalog. Direction:
#   "read"  — PLC/bridge writes, browser listens (actuators / Y bits)
#   "write" — browser writes, PLC reads via bridge (sensors / X bits)
TAG_CATALOG = {
    "SupplyCylinder": ("read",  "공급 실린더 (Y020)"),
    "Buzzer":         ("read",  "부저 (Y025)"),
    "Conv1":          ("read",  "컨베이어 1 (Y030)"),
    "Conv2":          ("read",  "컨베이어 2 (Y031)"),
    "Conv3":          ("read",  "컨베이어 3 (Y032)"),
    "Conv4":          ("read",  "컨베이어 4 (Y033)"),
    "Conv5":          ("read",  "컨베이어 5 (Y034)"),
    "Conv6":          ("read",  "컨베이어 6 (Y035)"),
    "Robot1":         ("read",  "로봇 1 (Y040)"),
    "Robot2":         ("read",  "로봇 2 (Y041)"),
    "Robot3":         ("read",  "로봇 3 (Y042)"),
    "Elevator":       ("read",  "엘리베이터 (Y050)"),
    "EmergencyStop":  ("write", "비상 정지 (X010)"),
    "SupplyDetect":   ("write", "공급 감지 (X020)"),
    "VisionDetect":   ("write", "비전 감지 (X021)"),
}

log = logging.getLogger("opcua_ws")


class Adapter:
    def __init__(self):
        self._clients = set()           # WebSocket connections
        self._tag_nodes = {}            # name → asyncua.Node
        self._state = {}                # name → last known value
        self._client = None

    async def run(self):
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)-5s %(message)s",
        )
        # WS server stays up across OPC UA reconnects so browsers keep their socket.
        ws_task = asyncio.create_task(self._ws_server())
        try:
            while True:
                try:
                    await self._opcua_loop()
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    log.warning("OPC UA loop error (%s) — retry in 3s", exc, exc_info=True)
                    await self._broadcast({
                        "type": "error",
                        "message": f"OPC UA 연결 끊김: {exc}. 3초 후 재시도.",
                    })
                    self._tag_nodes.clear()
                    self._state.clear()
                    await asyncio.sleep(3)
        finally:
            ws_task.cancel()
            with suppress(asyncio.CancelledError):
                await ws_task

    async def _opcua_loop(self):
        async with Client(OPCUA_ENDPOINT) as client:
            self._client = client
            log.info("✓ OPC UA connected: %s", OPCUA_ENDPOINT)
            await self._discover_tags()
            # Catalog may be empty if bridge doesn't expose anything we know —
            # still keep the connection alive so writes can go through once
            # tags show up.
            await self._send_catalog_to_all()
            await self._send_snapshot_to_all()
            await self._poll_loop()

    async def _discover_tags(self):
        """Walk Objects/Sensors + Objects/Actuators and snapshot initial values."""
        objects = self._client.nodes.objects
        wanted = set(TAG_CATALOG.keys())
        for folder_name in ("Sensors", "Actuators"):
            folder = None
            for child in await objects.get_children():
                bn = (await child.read_browse_name()).Name
                if bn == folder_name:
                    folder = child
                    break
            if folder is None:
                log.warning("folder '%s' not found", folder_name)
                continue
            for var in await folder.get_children():
                name = (await var.read_browse_name()).Name
                if name not in wanted:
                    continue
                try:
                    val = await var.read_value()
                except Exception:
                    val = False
                self._tag_nodes[name] = var
                self._state[name] = val
        found = sorted(self._tag_nodes.keys())
        missing = wanted - set(self._tag_nodes.keys())
        log.info("discovered %d/%d tags: %s", len(found), len(wanted), found)
        if missing:
            log.info("not exposed on server (skipped): %s", sorted(missing))

    async def _poll_loop(self):
        """Re-read every tag every POLL_MS and broadcast diffs."""
        while True:
            for name, node in list(self._tag_nodes.items()):
                try:
                    val = await node.read_value()
                except Exception:
                    # Node errors usually mean the server closed — break out and
                    # let the outer loop reconnect.
                    raise
                if self._state.get(name) != val:
                    self._state[name] = val
                    await self._broadcast({"type": "update", "tag": name, "value": val})
            await asyncio.sleep(POLL_MS / 1000)

    # ── WebSocket side ──────────────────────────────────────────────────
    async def _ws_server(self):
        async def handler(ws):
            self._clients.add(ws)
            peer = getattr(ws, "remote_address", ("?", "?"))
            log.info("WS + %s (total=%d)", peer, len(self._clients))
            try:
                await self._send_catalog(ws)
                await self._send_snapshot(ws)
                async for raw in ws:
                    await self._handle_client_msg(ws, raw)
            except websockets.ConnectionClosed:
                pass
            finally:
                self._clients.discard(ws)
                log.info("WS − %s (total=%d)", peer, len(self._clients))

        async with websockets.serve(handler, WS_HOST, WS_PORT):
            log.info("✓ WS listening on ws://%s:%d", WS_HOST, WS_PORT)
            await asyncio.Future()

    def _catalog_payload(self):
        return {
            "type": "catalog",
            "tags": [
                {"name": n, "direction": d, "label": l}
                for n, (d, l) in TAG_CATALOG.items()
                if n in self._tag_nodes
            ],
        }

    async def _send_catalog(self, ws):
        try:
            await ws.send(json.dumps(self._catalog_payload()))
        except Exception:
            pass

    async def _send_snapshot(self, ws):
        try:
            await ws.send(json.dumps({"type": "snapshot", "tags": dict(self._state)}))
        except Exception:
            pass

    async def _send_catalog_to_all(self):
        await self._broadcast(self._catalog_payload())

    async def _send_snapshot_to_all(self):
        await self._broadcast({"type": "snapshot", "tags": dict(self._state)})

    async def _handle_client_msg(self, ws, raw):
        try:
            msg = json.loads(raw)
        except Exception:
            return
        if msg.get("type") != "write":
            return
        name = msg.get("tag")
        value = msg.get("value")
        entry = TAG_CATALOG.get(name)
        if not entry or entry[0] != "write":
            await self._send_error(ws, f"tag '{name}' is not writable")
            return
        node = self._tag_nodes.get(name)
        if node is None:
            await self._send_error(ws, f"tag '{name}' not on server")
            return
        try:
            variant = ua.Variant(bool(value), ua.VariantType.Boolean)
            await node.write_value(variant)
        except Exception as exc:
            log.warning("write %s=%s failed: %s", name, value, exc)
            await self._send_error(ws, f"write {name}={value} failed: {exc}")

    async def _send_error(self, ws, message):
        try:
            await ws.send(json.dumps({"type": "error", "message": message}))
        except Exception:
            pass

    async def _broadcast(self, payload):
        if not self._clients:
            return
        msg = json.dumps(payload)
        dead = []
        for ws in list(self._clients):
            try:
                await ws.send(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._clients.discard(ws)


async def main():
    adapter = Adapter()
    loop = asyncio.get_running_loop()
    stop = asyncio.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop.set)
    runner = asyncio.create_task(adapter.run())
    await stop.wait()
    runner.cancel()
    with suppress(asyncio.CancelledError):
        await runner


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
