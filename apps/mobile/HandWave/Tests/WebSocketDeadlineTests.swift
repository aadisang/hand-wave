import Foundation
import Synchronization
import Testing

@testable import HandWave

struct WebSocketDeadlineTests {
  @Test
  func successKeepsTheSocketOpen() async throws {
    let socket = PendingSocketOperation()
    let value = try await withWebSocketDeadline(timeout: .seconds(60), cancel: socket.cancel) {
      42
    }
    #expect(value == 42)
    #expect(!socket.isCancelled)
  }

  @Test
  func timeoutUnblocksAnUnresponsiveSend() async {
    let socket = PendingSocketOperation()
    do {
      try await withWebSocketDeadline(timeout: .milliseconds(10), cancel: socket.cancel) {
        try await socket.send()
      }
      Issue.record("An unresponsive send must time out")
    } catch {
      #expect(socket.isCancelled)
    }
  }

  @Test
  func cancellationClosesTheSocketWithoutWaitingForTheDeadline() async {
    let socket = PendingSocketOperation()
    let task = Task {
      try await withWebSocketDeadline(timeout: .seconds(60), cancel: socket.cancel) {
        try await socket.send()
      }
    }
    task.cancel()
    do {
      try await task.value
      Issue.record("A cancelled connection must not succeed")
    } catch {
      #expect(socket.isCancelled)
    }
  }
}

/// Models socket I/O that only resumes when the transport is closed.
private final class PendingSocketOperation: Sendable {
  private struct State {
    var isCancelled = false
    var continuation: CheckedContinuation<Void, any Error>?
  }
  private let state = Mutex(State())

  var isCancelled: Bool { state.withLock { $0.isCancelled } }

  func send() async throws {
    try await withCheckedThrowingContinuation { continuation in
      let cancelled = state.withLock { state in
        if state.isCancelled { return true }
        state.continuation = continuation
        return false
      }
      if cancelled { continuation.resume(throwing: CancellationError()) }
    }
  }

  func cancel() {
    let continuation = state.withLock { state in
      state.isCancelled = true
      let continuation = state.continuation
      state.continuation = nil
      return continuation
    }
    continuation?.resume(throwing: CancellationError())
  }
}
