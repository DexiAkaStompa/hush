# Desktop call controls

The desktop sidebar hosts a compact call widget above the user profile while a
call is active. It shows the signaling and peer transport connection state, room
name, camera, screen sharing, microphone, deafen and disconnect controls. The
room name reopens the full call without changing the selected conversation.

`MediaStage` owns the call and renders `CallDock` through a React portal into the
sidebar. Both sets of controls operate on the same state, tracks and peer
connections. Minimizing or navigating does not create a second microphone or
restart the call. Mobile retains its existing sidebar and compact call controls.

Deafen silences received voice and shared audio and disables the outgoing
microphone track. Turning deafen off restores the user's previous microphone
choice. Explicitly enabling the microphone also clears deafen. The microphone
intent survives input device changes while deafened.

The audio popover changes the existing media settings for microphone, output
device and output volume. It refreshes the device list while open. The connection
popover displays the real WebRTC candidate-pair round-trip time, sampled every
five seconds during a call. No latency number is invented for an empty room.
Disconnected calls remove the timer and release capture tracks as before.

Window control callbacks explicitly call the Electron bridge with no arguments.
Passing a bridge function directly as a React event handler attempts to serialize
the React click event and throws `An object could not be cloned` before reaching
the main process. The trusted-frame checks and normal close behavior are intact.

Validation includes a regression test for the three window controls and a real
Electron check with isolated test accounts: window closure, two-participant
WebRTC audio, mute/deafen restoration, camera, screen sharing, audio settings,
navigation, six themes, track cleanup and the Android navigation regression.
