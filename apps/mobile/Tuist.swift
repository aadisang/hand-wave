import Foundation
import ProjectDescription

let tuist = Tuist(
  fullHandle: (ProcessInfo.processInfo.environment["TUIST_TOKEN"] ?? "").isEmpty
    ? nil : "SpareStudio/handwave",
  project: .tuist(
    generationOptions: .options(enforceExplicitDependencies: true)
  )
)
