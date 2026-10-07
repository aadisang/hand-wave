import SwiftUI
import UniformTypeIdentifiers

struct DevMenuView: View {
  @Environment(\.dismiss) private var dismiss
  @Environment(AppModel.self) private var appModel
  @AppStorage(AppSettingKey.showsLandmarks) private var showsLandmarks = true
  @AppStorage(AppSettingKey.showsPoseLandmarks) private var showsPoseLandmarks = false
  @AppStorage(AppSettingKey.inferenceMode) private var inferenceMode = InferenceMode.remote
  @State private var isPreparingLogs = false
  @State private var isLogExporterPresented = false
  @State private var logDocument: LogDocument?
  @State private var logExportError: String?

  var body: some View {
    NavigationStack {
      List {
        Section("Status") {
          DevRow("Source", activeSource)
          DevRow("Registration", registrationStatus)
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

        Section("Landmark Overlay") {
          Toggle("Landmarks", isOn: $showsLandmarks)
          Toggle("Pose Landmarks", isOn: $showsPoseLandmarks)
        }

        Section("Recognition") {
          Picker("Model", selection: $inferenceMode) {
            ForEach(InferenceMode.allCases) { mode in
              Text(mode.title).tag(mode)
            }
          }
          .pickerStyle(.segmented)
          .disabled(appModel.stream.isActive)

          Text(
            inferenceMode == .device
              ? "Runs the model on this phone. Text checks still use the network."
              : "Runs the model and text checks in the cloud."
          )
          .font(.footnote)
          .foregroundStyle(.secondary)
        }

        Section("Actions") {
          Button("Refresh Status", systemImage: "arrow.clockwise") {
            appModel.refresh()
          }

          Button(
            isPreparingLogs ? "Preparing Logs" : "Export Logs",
            systemImage: "square.and.arrow.up"
          ) {
            prepareLogExport()
          }
          .disabled(isPreparingLogs)

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
      .fileExporter(
        isPresented: $isLogExporterPresented,
        document: logDocument,
        contentType: .plainText,
        defaultFilename: "hand-wave-logs"
      ) { result in
        if case .failure(let error) = result {
          logExportError = error.localizedDescription
        }
      }
      .alert(
        "Could not export logs",
        isPresented: Binding(
          get: { logExportError != nil },
          set: { if !$0 { logExportError = nil } }
        )
      ) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(logExportError ?? "Unknown error")
      }
    }
  }

  private var activeSource: String {
    (appModel.stream.activeSource ?? appModel.stream.source).title
  }

  private var registrationStatus: String {
    switch appModel.wearables.registrationState {
    case .unavailable: "Unavailable"
    case .available: "Available"
    case .registering: "Registering"
    case .registered: "Registered"
    @unknown default: "Unknown"
    }
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

  private func prepareLogExport() {
    isPreparingLogs = true
    Task {
      defer { isPreparingLogs = false }
      do {
        logDocument = LogDocument(text: try await LogExporter.text())
        isLogExporterPresented = true
      } catch {
        logExportError = error.localizedDescription
      }
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
