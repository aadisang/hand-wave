import Foundation

enum InferenceStreamProtocol {
  static let version = 2
  static let subprotocolName = "handwave.v2"
}

enum StreamResponsePayload: Sendable {
  case pong(InferenceStreamPongResponse)
  case reset(InferenceStreamResetResponse)
  case result(InferenceStreamResultResponse)
  case error(InferenceStreamErrorResponse)

  var sequence: Int {
    switch self {
    case .pong(let response): response.sequence
    case .reset(let response): response.sequence
    case .result(let response): response.sequence
    case .error(let response): response.sequence
    }
  }

  static func decode(from data: Data) throws -> Self {
    let decoder = JSONDecoder()
    let header = try decoder.decode(StreamResponseHeader.self, from: data)
    guard header.protocolVersion == InferenceStreamProtocol.version else {
      throw StreamProtocolError.unsupportedVersion(header.protocolVersion)
    }
    switch header.type {
    case InferenceStreamPongResponse.InferenceType.pong.rawValue:
      return .pong(try decoder.decode(InferenceStreamPongResponse.self, from: data))
    case InferenceStreamResetResponse.InferenceType.reset.rawValue:
      return .reset(try decoder.decode(InferenceStreamResetResponse.self, from: data))
    case InferenceStreamResultResponse.InferenceType.result.rawValue:
      return .result(try decoder.decode(InferenceStreamResultResponse.self, from: data))
    case InferenceStreamErrorResponse.InferenceType.error.rawValue:
      return .error(try decoder.decode(InferenceStreamErrorResponse.self, from: data))
    default:
      throw StreamProtocolError.unknownType(header.type)
    }
  }
}

private struct StreamResponseHeader: Decodable {
  let type: String
  let protocolVersion: Int

  enum CodingKeys: String, CodingKey {
    case type
    case protocolVersion = "protocol"
  }
}

private enum StreamProtocolError: Error, LocalizedError {
  case unknownType(String)
  case unsupportedVersion(Int)

  var errorDescription: String? {
    switch self {
    case .unknownType(let type): "Unknown inference response: \(type)."
    case .unsupportedVersion: "The app and inference server need matching updates."
    }
  }
}
