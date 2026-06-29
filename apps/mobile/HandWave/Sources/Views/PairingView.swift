import SwiftUI

private enum ActionButtonMetrics {
  static let switchSize: CGFloat = 30
  static let iconSize: CGFloat = 22
}

struct PairingView: View {
  @Environment(AppModel.self) private var appModel

  var body: some View {
    VStack(spacing: 0) {
      Spacer(minLength: Spacing.xl)
      Hero()
      Spacer(minLength: Spacing.xl)
      PrimaryAction()
    }
    .padding(.horizontal, Spacing.xl)
    .padding(.top, Spacing.lg)
    .padding(.bottom, Spacing.xl)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(.canvas)
    .animation(Motion.standard, value: appModel.wearables.isRegistered)
    .animation(Motion.standard, value: appModel.stream.source)
  }
}

private struct Hero: View {
  var body: some View {
    VStack(spacing: Spacing.xl) {
      Image("BrandMark")
        .resizable()
        .aspectRatio(contentMode: .fit)
        .frame(width: 64, height: 64)
        .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .shadow(color: .black.opacity(0.5), radius: 18, y: 10)

      VStack(spacing: Spacing.sm) {
        Text("Hand Wave")
          .font(.appLargeTitle)
          .tracking(-0.4)
          .foregroundStyle(.textPrimary)
        Text("Signs from your glasses.")
          .font(.appCallout)
          .foregroundStyle(.textSecondary)
          .multilineTextAlignment(.center)
      }
    }
  }
}

private struct PrimaryAction: View {
  @Environment(AppModel.self) private var appModel
  @State private var taps = 0

  var body: some View {
    @Bindable var stream = appModel.stream

    VStack(spacing: Spacing.md) {
      if state.showsStatus {
        StatusLine(state: state)
      }

      HStack(spacing: Spacing.sm) {
        Button {
          taps &+= 1
          tap()
        } label: {
          HStack(spacing: Spacing.sm) {
            if state.isBusy {
              ProgressView()
                .controlSize(.small)
                .tint(.textPrimary)
            }
            Text(state.buttonTitle)
              .font(.satoshi(15, .semibold))
              .lineLimit(1)
              .minimumScaleFactor(0.82)
          }
          .foregroundStyle(.textPrimary)
          .frame(maxWidth: .infinity)
          .padding(.vertical, Spacing.xs)
        }
        .buttonStyle(.glass)
        .controlSize(.large)
        .buttonBorderShape(.capsule)
        .disabled(!state.canTap)

        SourceButton(source: $stream.source, isDisabled: appModel.stream.status != .idle)
      }
    }
    .sensoryFeedback(Haptic.primaryTap, trigger: taps)
    .animation(Motion.standard, value: state)
  }

  private func tap() {
    Task {
      appModel.refresh()
      if appModel.stream.source == .phone {
        await appModel.stream.start()
        return
      }
      guard appModel.wearables.isRegistered else {
        await appModel.wearables.connect()
        return
      }
      guard appModel.stream.hasActiveDevice else { return }
      if await appModel.wearables.ensureCameraPermission() {
        await appModel.stream.start()
      }
    }
  }

  private var state: PairingState {
    if appModel.stream.source == .phone {
      return appModel.stream.status == .connecting ? .startingCamera : .phoneReady
    }
    if appModel.wearables.isRegistering {
      return .registering
    }
    if !appModel.wearables.isRegistered {
      return .needsRegistration
    }
    if appModel.stream.status == .connecting {
      return .startingStream
    }
    if appModel.stream.hasActiveDevice {
      return .ready
    }
    if appModel.wearables.devices.isEmpty {
      return .waitingForDevice
    }
    return .waitingForActiveDevice
  }
}

private struct SourceButton: View {
  @Binding var source: StreamModel.Source
  let isDisabled: Bool

  var body: some View {
    Button {
      source = source == .glasses ? .phone : .glasses
    } label: {
      Label(title, systemImage: systemImage)
        .font(.system(size: 16, weight: .semibold))
        .labelStyle(.iconOnly)
        .frame(width: ActionButtonMetrics.iconSize, height: ActionButtonMetrics.iconSize)
        .frame(width: ActionButtonMetrics.switchSize, height: ActionButtonMetrics.switchSize)
    }
    .buttonStyle(.glass)
    .controlSize(.large)
    .buttonBorderShape(.circle)
    .disabled(isDisabled)
    .accessibilityLabel(title)
    .sensoryFeedback(Haptic.toggle, trigger: source)
  }

  private var title: String {
    switch source {
    case .glasses: "Use phone camera"
    case .phone: "Use glasses"
    }
  }

  private var systemImage: String {
    switch source {
    case .glasses: "camera.fill"
    case .phone: "eyeglasses"
    }
  }
}

private struct StatusLine: View {
  let state: PairingState
  @ScaledMetric private var iconBoxSize = 34
  @ScaledMetric private var iconSize = 15

  var body: some View {
    HStack(alignment: .center, spacing: Spacing.md) {
      icon

      VStack(alignment: .leading, spacing: 3) {
        Text(state.headline)
          .font(.satoshi(14, .semibold))
          .foregroundStyle(.textPrimary)
        Text(state.detail)
          .font(.appFootnote)
          .foregroundStyle(.textSecondary)
          .fixedSize(horizontal: false, vertical: true)
      }
      .layoutPriority(1)

      Spacer(minLength: 0)
    }
    .padding(.horizontal, Spacing.md)
    .padding(.vertical, Spacing.md)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
    .accessibilityElement(children: .combine)
  }

  private var icon: some View {
    Image(systemName: state.systemImage)
      .font(.system(size: iconSize, weight: .semibold))
      .foregroundStyle(state.iconStyle)
      .frame(width: iconBoxSize, height: iconBoxSize)
      .background(
        Circle()
          .fill(state.iconStyle.opacity(0.14))
      )
      .overlay(
        Circle()
          .strokeBorder(state.iconStyle.opacity(0.18), lineWidth: 1)
      )
      .accessibilityHidden(true)
  }
}

private enum PairingState: Equatable {
  case needsRegistration
  case registering
  case phoneReady
  case waitingForDevice
  case waitingForActiveDevice
  case ready
  case startingCamera
  case startingStream

  var headline: String {
    switch self {
    case .needsRegistration: "Connect glasses"
    case .registering: "Finish in Meta AI"
    case .phoneReady: "Use phone camera"
    case .waitingForDevice: "Reconnect glasses"
    case .waitingForActiveDevice: "Open glasses"
    case .ready: "Ready"
    case .startingCamera: "Starting camera"
    case .startingStream: "Starting camera"
    }
  }

  var detail: String {
    switch self {
    case .needsRegistration:
      "Approve Hand Wave in Meta AI."
    case .registering:
      "Approve, then return here."
    case .phoneReady:
      "Use the front or back camera."
    case .waitingForDevice:
      "Meta AI cannot see them."
    case .waitingForActiveDevice:
      "Open or wear them nearby."
    case .ready:
      "Ready to stream."
    case .startingCamera:
      "Opening device camera."
    case .startingStream:
      "Keep glasses open."
    }
  }

  var buttonTitle: String {
    switch self {
    case .needsRegistration: "Connect"
    case .registering: "Connecting"
    case .phoneReady: "Start Camera"
    case .waitingForDevice, .waitingForActiveDevice: "Waiting for Glasses"
    case .ready: "Start Streaming"
    case .startingCamera, .startingStream: "Starting"
    }
  }

  var systemImage: String {
    switch self {
    case .needsRegistration: "link"
    case .registering, .startingCamera, .startingStream: "hourglass"
    case .phoneReady: "camera.fill"
    case .waitingForDevice, .waitingForActiveDevice: "eyeglasses"
    case .ready: "checkmark.circle.fill"
    }
  }

  var iconStyle: Color {
    switch self {
    case .ready: Color(hex: 0x9EE7C8)
    case .phoneReady: Color(hex: 0x9CCBFF)
    case .waitingForDevice, .waitingForActiveDevice: Color(hex: 0xF2C96D)
    default: Color(hex: 0xF5F5F5)
    }
  }

  var canTap: Bool {
    switch self {
    case .needsRegistration, .phoneReady, .ready: true
    case .registering, .waitingForDevice, .waitingForActiveDevice, .startingCamera, .startingStream:
      false
    }
  }

  var isBusy: Bool {
    switch self {
    case .registering, .startingCamera, .startingStream: true
    default: false
    }
  }

  var showsStatus: Bool {
    self != .ready && self != .phoneReady
  }
}
