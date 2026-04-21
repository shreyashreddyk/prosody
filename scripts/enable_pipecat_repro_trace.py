#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path


TRACE_MARKER = "[prosody-pipecat-trace]"


@dataclass(frozen=True)
class PatchOperation:
    label: str
    needle: str
    replacement: str


REPO_ROOT = Path(__file__).resolve().parents[1]

TARGETS: dict[Path, list[PatchOperation]] = {
    REPO_ROOT / "node_modules/@pipecat-ai/small-webrtc-transport/dist/index.js": [
        PatchOperation(
            label="wav-init-catch",
            needle="""error_1 = _a.sent();
                        return [
                            3 /*break*/ ,
                            3
                        ];""",
            replacement="""error_1 = _a.sent();
                        console.debug("[prosody-pipecat-trace] wav initialize failed", error_1);
                        return [
                            3 /*break*/ ,
                            3
                        ];""",
        ),
        PatchOperation(
            label="wav-update-mic-catch",
            needle="""error_2 = _c.sent();
                        return [
                            3 /*break*/ ,
                            7
                        ];""",
            replacement="""error_2 = _c.sent();
                        console.debug("[prosody-pipecat-trace] wav updateMic failed", error_2);
                        return [
                            3 /*break*/ ,
                            7
                        ];""",
        ),
        PatchOperation(
            label="wav-start-recording",
            needle="""track = (_a = this._wavRecorder.stream) === null || _a === void 0 ? void 0 : _a.getAudioTracks()[0];
                        if (track) (_c = (_b = this._callbacks).onTrackStarted) === null || _c === void 0 || _c.call(_b, track, $fc49a56cd8739127$var$localParticipant());""",
            replacement="""track = (_a = this._wavRecorder.stream) === null || _a === void 0 ? void 0 : _a.getAudioTracks()[0];
                        console.debug("[prosody-pipecat-trace] wav recorder started", {
                            hasTrack: !!track,
                            trackLabel: track === null || track === void 0 ? void 0 : track.label
                        });
                        if (track) (_c = (_b = this._callbacks).onTrackStarted) === null || _c === void 0 || _c.call(_b, track, $fc49a56cd8739127$var$localParticipant());""",
        ),
        PatchOperation(
            label="flush-ice-candidates",
            needle="""const payload = {
                pc_id: this.pc_id,
                candidates: candidates.map((c)=>({
                        candidate: c.candidate,
                        sdp_mid: c.sdpMid,
                        sdp_mline_index: c.sdpMLineIndex
                    }))
            };
            await fetch(this._webrtcRequest.endpoint, {""",
            replacement="""const payload = {
                pc_id: this.pc_id,
                candidates: candidates.map((c)=>({
                        candidate: c.candidate,
                        sdp_mid: c.sdpMid,
                        sdp_mline_index: c.sdpMLineIndex
                    }))
            };
            console.debug("[prosody-pipecat-trace] flushIceCandidates", {
                pc_id: this.pc_id,
                candidateCount: payload.candidates.length
            });
            await fetch(this._webrtcRequest.endpoint, {""",
        ),
        PatchOperation(
            label="negotiate-request",
            needle="""const answer = await (0, $99wTV$makeRequest)(request);""",
            replacement="""console.debug("[prosody-pipecat-trace] negotiate request", {
                pc_id: this.pc_id,
                restart_pc: recreatePeerConnection
            });
            const answer = await (0, $99wTV$makeRequest)(request);""",
        ),
        PatchOperation(
            label="negotiate-catch",
            needle="""} catch (e) {
            (0, $99wTV$logger).debug(`Reconnection attempt ${this.reconnectionAttempts} failed: ${e}`);
            this.isReconnecting = false;
            setTimeout(()=>this.attemptReconnection(true), 2000);
        }""",
            replacement="""} catch (e) {
            console.debug("[prosody-pipecat-trace] negotiate failed", {
                reconnectionAttempts: this.reconnectionAttempts,
                error: e
            });
            (0, $99wTV$logger).debug(`Reconnection attempt ${this.reconnectionAttempts} failed: ${e}`);
            this.isReconnecting = false;
            setTimeout(()=>this.attemptReconnection(true), 2000);
        }""",
        ),
    ],
    REPO_ROOT / "node_modules/@pipecat-ai/small-webrtc-transport/dist/index.module.js": [
        PatchOperation(
            label="wav-init-catch",
            needle="""error_1 = _a.sent();
                        return [
                            3 /*break*/ ,
                            3
                        ];""",
            replacement="""error_1 = _a.sent();
                        console.debug("[prosody-pipecat-trace] wav initialize failed", error_1);
                        return [
                            3 /*break*/ ,
                            3
                        ];""",
        ),
        PatchOperation(
            label="wav-update-mic-catch",
            needle="""error_2 = _c.sent();
                        return [
                            3 /*break*/ ,
                            7
                        ];""",
            replacement="""error_2 = _c.sent();
                        console.debug("[prosody-pipecat-trace] wav updateMic failed", error_2);
                        return [
                            3 /*break*/ ,
                            7
                        ];""",
        ),
        PatchOperation(
            label="wav-start-recording",
            needle="""track = (_a = this._wavRecorder.stream) === null || _a === void 0 ? void 0 : _a.getAudioTracks()[0];
                        if (track) (_c = (_b = this._callbacks).onTrackStarted) === null || _c === void 0 || _c.call(_b, track, $fc49a56cd8739127$var$localParticipant());""",
            replacement="""track = (_a = this._wavRecorder.stream) === null || _a === void 0 ? void 0 : _a.getAudioTracks()[0];
                        console.debug("[prosody-pipecat-trace] wav recorder started", {
                            hasTrack: !!track,
                            trackLabel: track === null || track === void 0 ? void 0 : track.label
                        });
                        if (track) (_c = (_b = this._callbacks).onTrackStarted) === null || _c === void 0 || _c.call(_b, track, $fc49a56cd8739127$var$localParticipant());""",
        ),
        PatchOperation(
            label="flush-ice-candidates",
            needle="""const payload = {
                pc_id: this.pc_id,
                candidates: candidates.map((c)=>({
                        candidate: c.candidate,
                        sdp_mid: c.sdpMid,
                        sdp_mline_index: c.sdpMLineIndex
                    }))
            };
            await fetch(this._webrtcRequest.endpoint, {""",
            replacement="""const payload = {
                pc_id: this.pc_id,
                candidates: candidates.map((c)=>({
                        candidate: c.candidate,
                        sdp_mid: c.sdpMid,
                        sdp_mline_index: c.sdpMLineIndex
                    }))
            };
            console.debug("[prosody-pipecat-trace] flushIceCandidates", {
                pc_id: this.pc_id,
                candidateCount: payload.candidates.length
            });
            await fetch(this._webrtcRequest.endpoint, {""",
        ),
        PatchOperation(
            label="negotiate-request",
            needle="""const answer = await (0, $99wTV$makeRequest)(request);""",
            replacement="""console.debug("[prosody-pipecat-trace] negotiate request", {
                pc_id: this.pc_id,
                restart_pc: recreatePeerConnection
            });
            const answer = await (0, $99wTV$makeRequest)(request);""",
        ),
        PatchOperation(
            label="negotiate-catch",
            needle="""} catch (e) {
            (0, $99wTV$logger).debug(`Reconnection attempt ${this.reconnectionAttempts} failed: ${e}`);
            this.isReconnecting = false;
            setTimeout(()=>this.attemptReconnection(true), 2000);
        }""",
            replacement="""} catch (e) {
            console.debug("[prosody-pipecat-trace] negotiate failed", {
                reconnectionAttempts: this.reconnectionAttempts,
                error: e
            });
            (0, $99wTV$logger).debug(`Reconnection attempt ${this.reconnectionAttempts} failed: ${e}`);
            this.isReconnecting = false;
            setTimeout(()=>this.attemptReconnection(true), 2000);
        }""",
        ),
    ],
    REPO_ROOT / "node_modules/@pipecat-ai/client-js/dist/index.js": [
        PatchOperation(
            label="client-connect-start",
            needle="""        // Establish transport session and await bot ready signal
        return new Promise((resolve, reject)=>{""",
            replacement="""        // Establish transport session and await bot ready signal
        console.debug("[prosody-pipecat-trace] client connect invoked", {
            hasConnectParams: !!connectParams
        });
        return new Promise((resolve, reject)=>{""",
        ),
        PatchOperation(
            label="client-connect-catch",
            needle="""                } catch (e) {
                    this.disconnect();
                    reject(e);
                    return;
                }""",
            replacement="""                } catch (e) {
                    console.debug("[prosody-pipecat-trace] client connect failed", e);
                    this.disconnect();
                    reject(e);
                    return;
                }""",
        ),
        PatchOperation(
            label="client-disconnect",
            needle="""    async disconnect() {
        await this._transport.disconnect();
        this._messageDispatcher.disconnect();
    }""",
            replacement="""    async disconnect() {
        console.debug("[prosody-pipecat-trace] client disconnect invoked");
        await this._transport.disconnect();
        this._messageDispatcher.disconnect();
        console.debug("[prosody-pipecat-trace] client disconnect completed");
    }""",
        ),
    ],
    REPO_ROOT / "node_modules/@pipecat-ai/client-js/dist/index.module.js": [
        PatchOperation(
            label="client-connect-start",
            needle="""        // Establish transport session and await bot ready signal
        return new Promise((resolve, reject)=>{""",
            replacement="""        // Establish transport session and await bot ready signal
        console.debug("[prosody-pipecat-trace] client connect invoked", {
            hasConnectParams: !!connectParams
        });
        return new Promise((resolve, reject)=>{""",
        ),
        PatchOperation(
            label="client-connect-catch",
            needle="""                } catch (e) {
                    this.disconnect();
                    reject(e);
                    return;
                }""",
            replacement="""                } catch (e) {
                    console.debug("[prosody-pipecat-trace] client connect failed", e);
                    this.disconnect();
                    reject(e);
                    return;
                }""",
        ),
        PatchOperation(
            label="client-disconnect",
            needle="""    async disconnect() {
        await this._transport.disconnect();
        this._messageDispatcher.disconnect();
    }""",
            replacement="""    async disconnect() {
        console.debug("[prosody-pipecat-trace] client disconnect invoked");
        await this._transport.disconnect();
        this._messageDispatcher.disconnect();
        console.debug("[prosody-pipecat-trace] client disconnect completed");
    }""",
        ),
    ],
}


def backup_path(path: Path) -> Path:
    return path.with_suffix(path.suffix + ".prosodydiag.bak")


def enable() -> int:
    for path, operations in TARGETS.items():
        if not path.exists():
            print(f"missing target: {path}", file=sys.stderr)
            return 1
        backup = backup_path(path)
        if not backup.exists():
            shutil.copy2(path, backup)
        content = path.read_text(encoding="utf-8")
        for operation in operations:
            if operation.replacement in content:
                continue
            if operation.needle not in content:
                print(f"unable to apply {operation.label} in {path}", file=sys.stderr)
                return 1
            content = content.replace(operation.needle, operation.replacement, 1)
        path.write_text(content, encoding="utf-8")
        print(f"patched {path.relative_to(REPO_ROOT)}")
    return 0


def disable() -> int:
    for path in TARGETS:
        backup = backup_path(path)
        if not backup.exists():
            print(f"no backup for {path.relative_to(REPO_ROOT)}")
            continue
        shutil.copy2(backup, path)
        backup.unlink()
        print(f"restored {path.relative_to(REPO_ROOT)}")
    return 0


def status() -> int:
    for path in TARGETS:
        if not path.exists():
            print(f"{path.relative_to(REPO_ROOT)}: missing")
            continue
        content = path.read_text(encoding="utf-8")
        enabled = TRACE_MARKER in content
        has_backup = backup_path(path).exists()
        print(
            f"{path.relative_to(REPO_ROOT)}: "
            f"{'enabled' if enabled else 'disabled'} "
            f"(backup={'yes' if has_backup else 'no'})"
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Temporarily patch installed Pipecat bundles with extra repro logging.",
    )
    parser.add_argument("action", choices=["enable", "disable", "status"])
    args = parser.parse_args()
    if args.action == "enable":
        return enable()
    if args.action == "disable":
        return disable()
    return status()


if __name__ == "__main__":
    raise SystemExit(main())
