# Background music recovery after standby

The controller owns one streamed audio element. It releases that element before
Home loses foreground or starts a live preview. A new eligible foreground visit
can recreate a failed or interrupted player. Autoplay policy denial still waits
for a trusted gesture or explicit Retry playback.

Transient startup timeouts, aborted playback and media error codes 1/2 get one
fresh-player retry after two seconds per foreground visit. Repeated renders do
not replenish that budget. Decode/unsupported errors do not retry on a timer.
Disabling music, leaving Home, entering live preview, or destroying the controller
cancels pending recovery. A replaced player's callbacks cannot revive it.

Music routing is tied to the current player generation and foreground eligibility.
Both native query completions are checked before connecting audio. Leaving the
playing phase invalidates the pending routing timer. Routing failure is visible
in music settings and offers Retry playback; startup timeouts no longer claim
that the file is missing. Controller state retains the last failure kind/code.

Long-standby recovery still needs an on-device test. This handles the launcher's
audio player; it does not repair native HDMI services or restart shared services.
