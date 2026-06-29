import SwiftUI

struct DevMenuView: View {
  @Environment(\.dismiss) private var dismiss
  @Environment(AppModel.self) private var appModel
  @State private var speechLogURL: URL?
  @State private var speechLogError: String?

  var body: some View {
    NavigationStack {
      List {
        Section("Status") {
          DevRow("Source", activeSource)
          DevRow("Registration", String(describing: appModel.wearables.registrationState))
          DevRow("Glasses", glassesStatus)
          DevRow("Stream", streamStatus)
        }

        if !appModel.wearables.devices.isEmpty {
          Section("Devices") {
            ForEach(Array(appModel.wearables.devices.enumerated()), id: \.offset) { _, device in
              Text(appModel.wearables.deviceName(for: device))
            }
          }
        }

        Section("Visual Debug") {
          Toggle(
            "Pose Landmarks",
            isOn: Binding(
              get: { appModel.showsPoseLandmarks },
              set: { appModel.showsPoseLandmarks = $0 }
            )
          )
        }

        Section("Speech Diagnostics") {
          DevRow("Entries", "\(appModel.stream.speechLogCount)")

          Button("Prepare Speech Log", systemImage: "doc.badge.arrow.up") {
            do {
              speechLogURL = try appModel.stream.exportSpeechLog()
              speechLogError = nil
            } catch {
              speechLogError = error.localizedDescription
            }
          }
          .disabled(appModel.stream.speechLogCount == 0)

          if let speechLogURL {
            ShareLink(item: speechLogURL) {
              Label("Share Speech Log", systemImage: "square.and.arrow.up")
            }
          }

          Button("Clear Speech Log", systemImage: "trash", role: .destructive) {
            appModel.stream.clearSpeechLog()
            speechLogURL = nil
          }
          .disabled(appModel.stream.speechLogCount == 0)

          if let speechLogError {
            Text(speechLogError)
              .font(.appFootnote)
              .foregroundStyle(.red)
          }
        }

        Section("Actions") {
          Button("Refresh Status", systemImage: "arrow.clockwise") {
            appModel.refresh()
          }

          if appModel.stream.isActive {
            Button("Stop Stream", systemImage: "stop.fill", role: .destructive) {
              Task {
                await appModel.stream.stop()
                appModel.refresh()
              }
            }
          }

          if appModel.canResetConnection {
            Button(
              "Reset Connection",
              systemImage: "arrow.triangle.2.circlepath",
              role: .destructive
            ) {
              Task {
                await appModel.resetConnection()
                dismiss()
              }
            }
          }
        }
      }
      .navigationTitle("Dev Menu")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Done") { dismiss() }
        }
      }
    }
  }

  private var activeSource: String {
    (appModel.stream.activeSource ?? appModel.stream.source).title
  }

  private var glassesStatus: String {
    if !appModel.wearables.isRegistered {
      return "Not connected"
    }
    if appModel.stream.hasActiveDevice {
      return "Ready"
    }
    return appModel.wearables.devices.isEmpty ? "Not visible" : "Visible"
  }

  private var streamStatus: String {
    switch appModel.stream.status {
    case .idle: "Idle"
    case .connecting: "Starting"
    case .streaming: "Streaming"
    }
  }
}

private struct DevRow: View {
  let title: String
  let value: String

  init(_ title: String, _ value: String) {
    self.title = title
    self.value = value
  }

  var body: some View {
    HStack {
      Text(title)
      Spacer(minLength: Spacing.md)
      Text(value)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.trailing)
    }
  }
}
