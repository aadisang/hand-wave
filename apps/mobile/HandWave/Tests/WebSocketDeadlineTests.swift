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
  func failedIOCancelsTheDeadlineImmediately() async {
    let started = ContinuousClock.now
    let socket = PendingSocketOperation()
    do {
      let _: Int = try await withWebSocketDeadline(timeout: .seconds(60), cancel: socket.cancel) {
        throw InferenceFailure.unexpected("Connection refused")
      }
      Issue.record("The connection error must propagate")
    } catch {
      #expect(error as? InferenceFailure == .unexpected("Connection refused"))
      #expect(started.duration(to: .now) < .seconds(2))
    }
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
      #expect(error is WebSocketResponseTimeout)
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
    while !socket.isPending { await Task.yield() }
    task.cancel()
    do {
      try await task.value
      Issue.record("A cancelled connection must not succeed")
    } catch {
      #expect(socket.isCancelled)
      #expect(error as? InferenceFailure == .cancelled)
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
  var isPending: Bool { state.withLock { $0.continuation != nil } }

  func send() async throws {
    try await withCheckedThrowingContinuation { continuation in
      let cancelled = state.withLock { state in
        if state.isCancelled { return true }
        state.continuation = continuation
        return false
      }
      if cancelled { continuation.resume(throwing: URLError(.networkConnectionLost)) }
    }
  }

  func cancel() {
    let continuation = state.withLock { state in
      state.isCancelled = true
      let continuation = state.continuation
      state.continuation = nil
      return continuation
    }
    continuation?.resume(throwing: URLError(.networkConnectionLost))
  }
}
