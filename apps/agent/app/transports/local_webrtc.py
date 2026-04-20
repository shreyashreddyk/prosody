from __future__ import annotations

from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport


def build_smallwebrtc_transport(
    connection: SmallWebRTCConnection,
    *,
    input_sample_rate: int,
    output_sample_rate: int,
) -> SmallWebRTCTransport:
    return SmallWebRTCTransport(
        connection,
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            vad_enabled=False,
            audio_in_sample_rate=input_sample_rate,
            audio_out_sample_rate=output_sample_rate,
        ),
    )
