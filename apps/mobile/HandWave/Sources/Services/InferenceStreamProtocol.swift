import Foundation

enum StreamResponsePayload {
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
}

private enum StreamProtocolError: Error {
  case unknownType(String)
}
