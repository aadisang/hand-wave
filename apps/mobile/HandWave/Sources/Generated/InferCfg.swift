import Foundation

enum InferCfg {
  private static let config: InferenceConfig = {
    guard let url = Bundle(for: InferCfgBundleToken.self).url(
      forResource: "config",
      withExtension: "json"
    ) else {
      fatalError("Missing bundled inference config.json")
    }

    do {
      let data = try Data(contentsOf: url)
      return try JSONDecoder().decode(InferenceConfig.self, from: data)
    } catch {
      fatalError("Invalid bundled inference config.json: \(error)")
    }
  }()

  enum Decode {
    static var window: Int { InferCfg.config.decode.window }
  }

  enum Stream {
    static var fps: Int { InferCfg.config.stream.fps }
    static var min: Int { InferCfg.config.stream.min }
    static var stride: Int { InferCfg.config.stream.stride }
    static var idle: Int { InferCfg.config.stream.idle }
    static var lost: Int { InferCfg.config.stream.lost }
    static var holdMs: Int { InferCfg.config.stream.holdMs }
    static var motion: Double { InferCfg.config.stream.motion }
  }

  enum MP {
    enum Smooth {
      enum Hand {
        static var freq: Double { InferCfg.config.mp.smooth.hand.freq }
        static var cutoff: Double { InferCfg.config.mp.smooth.hand.cutoff }
        static var beta: Double { InferCfg.config.mp.smooth.hand.beta }
        static var dCutoff: Double { InferCfg.config.mp.smooth.hand.dCutoff }
      }

      enum Pose {
        static var freq: Double { InferCfg.config.mp.smooth.pose.freq }
        static var cutoff: Double { InferCfg.config.mp.smooth.pose.cutoff }
        static var beta: Double { InferCfg.config.mp.smooth.pose.beta }
        static var dCutoff: Double { InferCfg.config.mp.smooth.pose.dCutoff }
      }
    }
  }
}

private final class InferCfgBundleToken {}
