# Hand Wave Mobile

SwiftUI iOS client for camera-stream sign recognition with Meta wearables.

## Setup

The app uses Meta Wearables DAT SDK 1.0.0 and requires Xcode 26 or later, Tuist, and CocoaPods. Create the optional local configuration before
using a physical device:

```sh
cp apps/mobile/Configurations/HandWave.xcconfig.example apps/mobile/Configurations/HandWave.xcconfig
```

Add your Meta app credentials and Apple development team to that file. Both Debug and Release
use `https://sinarck--hand-wave-inference.modal.run` by default. That service accepts cloud
landmarks and on-device model emissions. `handwave.sh` serves the website, not the inference API.

For local backend development, override `HANDWAVE_INFERENCE_URL` and
`HANDWAVE_DEVICE_INFERENCE_URL` in that file. Use your Mac's LAN address on an iPhone;
`localhost` only works in the simulator. Connection failures show the actual error in the
camera view and retry automatically. The initial connection has a 120-second deadline to
allow a cloud cold start.

Generate dependencies and open the workspace from the repository root:

```sh
moon run mobile:open
```

Run the iOS tests with:

```sh
moon run mobile:test
```
