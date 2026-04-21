from __future__ import annotations

from typing import Any


def summarize_sdp(sdp: str | None) -> dict[str, Any]:
    if not sdp:
        return {}

    media: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    for raw_line in sdp.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("m="):
            parts = line[2:].split()
            kind = parts[0] if parts else "unknown"
            current = {
                "kind": kind,
                "port": parts[1] if len(parts) > 1 else None,
                "protocol": parts[2] if len(parts) > 2 else None,
                "payloadTypes": parts[3:] if len(parts) > 3 else [],
                "direction": None,
                "mid": None,
                "msid": None,
                "iceUfrag": None,
                "setup": None,
                "rtcpMux": False,
                "rtpmap": [],
            }
            media.append(current)
            continue
        if current is None or not line.startswith("a="):
            continue

        if line in ("a=sendrecv", "a=sendonly", "a=recvonly", "a=inactive"):
            current["direction"] = line[2:]
        elif line.startswith("a=mid:"):
            current["mid"] = line[6:]
        elif line.startswith("a=msid:"):
            current["msid"] = line[7:]
        elif line.startswith("a=ice-ufrag:"):
            current["iceUfrag"] = line[12:]
        elif line.startswith("a=setup:"):
            current["setup"] = line[8:]
        elif line == "a=rtcp-mux":
            current["rtcpMux"] = True
        elif line.startswith("a=rtpmap:"):
            current["rtpmap"].append(line[9:])

    return {
        "mediaCount": len(media),
        "kinds": [entry["kind"] for entry in media],
        "directions": [entry.get("direction") for entry in media],
        "media": media,
    }


def summarize_peer_connection(peer_connection: Any) -> list[dict[str, Any]]:
    summary: list[dict[str, Any]] = []
    try:
        transceivers = peer_connection.getTransceivers()
    except Exception:
        return summary

    for index, transceiver in enumerate(transceivers):
        sender_track = getattr(getattr(transceiver, "sender", None), "track", None)
        receiver_track = getattr(getattr(transceiver, "receiver", None), "track", None)
        summary.append(
            {
                "index": index,
                "mid": getattr(transceiver, "mid", None),
                "direction": getattr(transceiver, "direction", None),
                "currentDirection": getattr(transceiver, "currentDirection", None),
                "senderTrackKind": getattr(sender_track, "kind", None),
                "receiverTrackKind": getattr(receiver_track, "kind", None),
                "receiverTrackId": getattr(receiver_track, "id", None),
                "receiverTrackReadyState": getattr(receiver_track, "readyState", None),
            }
        )
    return summary


def summarize_connection_state(connection: Any) -> dict[str, Any]:
    peer_connection = getattr(connection, "pc", None)
    if peer_connection is None:
        return {}

    return {
        "pc_id": getattr(connection, "pc_id", None),
        "connectionState": getattr(peer_connection, "connectionState", None),
        "iceConnectionState": getattr(peer_connection, "iceConnectionState", None),
        "iceGatheringState": getattr(peer_connection, "iceGatheringState", None),
        "signalingState": getattr(peer_connection, "signalingState", None),
        "transceivers": summarize_peer_connection(peer_connection),
    }
