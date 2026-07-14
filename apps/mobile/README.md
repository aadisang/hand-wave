# Hand Wave Mobile

SwiftUI iOS client for camera-stream sign recognition with Meta wearables.

## Setup

The app requires Xcode 26, Tuist, and CocoaPods. Create the optional local configuration before
using a physical device:

```sh
cp apps/mobile/Configurations/HandWave.xcconfig.example apps/mobile/Configurations/HandWave.xcconfig
```

Add your Meta app credentials and Apple development team to that file. You can also override
`HANDWAVE_INFERENCE_URL` with the inference server's LAN address.

Generate dependencies and open the workspace from the repository root:

```sh
moon run mobile:open
```

Run the iOS tests with:

```sh
moon run mobile:test
```
