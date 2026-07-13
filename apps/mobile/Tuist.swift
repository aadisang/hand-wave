import ProjectDescription

let tuist = Tuist(
  fullHandle: "SpareStudio/handwave",
  project: .tuist(
    generationOptions: .options(enforceExplicitDependencies: true)
  )
)
