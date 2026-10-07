# Hand Wave Mobile

SwiftUI iOS client for camera-stream sign recognition with Meta wearables.

## Setup

The app uses Meta Wearables DAT SDK 1.0.0 and requires Xcode 26 or later, Tuist, and CocoaPods.
Create the optional local configuration before using a physical device:

```sh
cp apps/mobile/Configurations/HandWave.xcconfig.example apps/mobile/Configurations/HandWave.xcconfig
```

Add your Meta app credentials and Apple development team to that file. You can also override
`HANDWAVE_INFERENCE_URL` with the inference server's LAN address for Debug builds.

Both build configurations use `https://sinarck--hand-wave-inference.modal.run` by default.
Release always uses that service. `handwave.sh` serves the website, not the inference API.
Camera images stay on the phone; the app sends landmarks to the cloud for recognition.
Connection failures show the actual error and retry automatically. The full initial
connection attempt has a 120-second deadline to allow a cloud cold start.

Generate dependencies and open the workspace from the repository root:

```sh
moon run mobile:open
```

Run the iOS tests with:

```sh
moon run mobile:test
```
