import SwiftUI

struct PairingView: View {
  @Environment(AppModel.self) private var appModel

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
        .padding(.bottom, 40)

      VStack(alignment: .leading, spacing: 28) {
        LabeledSection("Status") { StatusLine() }
        if appModel.wearables.isRegistered {
          LabeledSection("Device") { DeviceList() }
        }
      }

      Spacer(minLength: 0)

      VStack(spacing: 12) {
        PrimaryAction()
        if appModel.wearables.isRegistered {
          Button(role: .destructive) {
            Task { await appModel.wearables.disconnect() }
          } label: {
            Text("Disconnect")
              .font(.subheadline.weight(.medium))
              .padding(.vertical, 6)
          }
        }
      }
    }
    .padding(.horizontal, 24)
    .padding(.top, 12)
    .padding(.bottom, 24)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("HAND WAVE")
        .font(.system(.caption2, design: .monospaced))
        .tracking(2)
        .foregroundStyle(.tertiary)
      Text("Sign language,\nfrom the wearable.")
        .font(.system(size: 32, weight: .semibold, design: .serif))
        .lineSpacing(2)
        .foregroundStyle(.primary)
    }
  }
}

// MARK: - Section primitive

private struct LabeledSection<Content: View>: View {
  let label: String
  @ViewBuilder let content: () -> Content

  init(_ label: String, @ViewBuilder content: @escaping () -> Content) {
    self.label = label
    self.content = content
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text(label.uppercased())
        .font(.system(.caption2, design: .monospaced))
        .tracking(1.4)
        .foregroundStyle(.tertiary)
      content()
    }
  }
}

// MARK: - Status

private struct StatusLine: View {
  @Environment(AppModel.self) private var appModel

  var body: some View {
    HStack(spacing: 12) {
      StatusDot(color: state.color, pulse: state.pulse)
      Text(state.label)
        .font(.body.weight(.medium))
        .foregroundStyle(.primary)
        .contentTransition(.opacity)
      Spacer()
    }
    .animation(.easeInOut(duration: 0.2), value: state)
  }

  private var state: ConnectionState {
    let wearables = appModel.wearables
    if !wearables.isRegistered {
      return wearables.isRegistering ? .connecting : .disconnected
    }
    if wearables.devices.isEmpty { return .waitingOnDevice }
    return appModel.stream.hasActiveDevice ? .ready : .asleep
  }
}

private enum ConnectionState: Hashable {
  case disconnected, connecting, waitingOnDevice, asleep, ready

  var label: String {
    switch self {
    case .disconnected: "Not connected"
    case .connecting: "Connecting"
    case .waitingOnDevice: "Waiting on device"
    case .asleep: "Glasses asleep"
    case .ready: "Ready to stream"
    }
  }

  var color: Color {
    switch self {
    case .disconnected: .secondary
    case .connecting: .blue
    case .waitingOnDevice, .asleep: .orange
    case .ready: .green
    }
  }

  var pulse: Bool {
    switch self {
    case .connecting, .asleep, .waitingOnDevice: true
    case .disconnected, .ready: false
    }
  }
}

private struct StatusDot: View {
  let color: Color
  let pulse: Bool

  var body: some View {
    Image(systemName: "circle.fill")
      .font(.system(size: 8))
      .foregroundStyle(color)
      .symbolEffect(.pulse, isActive: pulse)
  }
}

// MARK: - Devices

private struct DeviceList: View {
  @Environment(AppModel.self) private var appModel

  var body: some View {
    if appModel.wearables.devices.isEmpty {
      Text("Open the Meta AI app and grant camera access to register your glasses.")
        .font(.callout)
        .foregroundStyle(.secondary)
    } else {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(Array(appModel.wearables.devices.enumerated()), id: \.element) { index, id in
          if index > 0 { Divider() }
          HStack(spacing: 12) {
            Text(appModel.wearables.deviceName(for: id))
              .font(.body)
              .foregroundStyle(.primary)
            Spacer()
            Text(appModel.stream.hasActiveDevice ? "Active" : "Sleeping")
              .font(.system(.footnote, design: .monospaced))
              .foregroundStyle(appModel.stream.hasActiveDevice ? .secondary : .tertiary)
          }
          .padding(.vertical, 14)
        }
      }
    }
  }
}

// MARK: - Primary action

private struct PrimaryAction: View {
  @Environment(AppModel.self) private var appModel

  var body: some View {
    Button(action: tap) {
      Text(title)
        .font(.body.weight(.semibold))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }
    .buttonStyle(.glassProminent)
    .controlSize(.extraLarge)
    .buttonBorderShape(.capsule)
    .disabled(disabled)
  }

  private func tap() {
    Task {
      if appModel.wearables.isRegistered {
        if await appModel.wearables.ensureCameraPermission() {
          await appModel.stream.start()
        }
      } else {
        await appModel.wearables.connect()
      }
    }
  }

  private var title: String {
    if !appModel.wearables.isRegistered {
      return appModel.wearables.isRegistering ? "Connecting" : "Connect Glasses"
    }
    return appModel.stream.status == .connecting ? "Starting" : "Start Streaming"
  }

  private var disabled: Bool {
    if !appModel.wearables.isRegistered { return appModel.wearables.isRegistering }
    if appModel.stream.status == .connecting { return true }
    return appModel.wearables.devices.isEmpty || !appModel.stream.hasActiveDevice
  }
}
