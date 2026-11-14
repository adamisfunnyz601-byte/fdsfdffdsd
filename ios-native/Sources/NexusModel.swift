import Foundation
import SwiftUI
import AVFoundation

@MainActor
final class NexusModel: ObservableObject {
    @Published var username = ""
    @Published var serialKey = ""
    @Published var currentUser: [String: Any]?
    @Published var users: [[String: Any]] = []
    @Published var messages: [[String: Any]] = []
    @Published var selectedUser: [String: Any]?
    @Published var draft = ""
    @Published var busy = false
    @Published var error: String?
    @Published var connected = false
    private let base = URL(string: "https://nexus.tunnelto.me")!
    private var poller: Task<Void, Never>?
    private var activeSound: AVAudioPlayer?

    func playSound(_ name: String) {
        guard let url = Bundle.main.url(forResource: name, withExtension: "wav") else {
            error = "Sound asset not found: \\(name)"; return
        }
        do {
            activeSound = try AVAudioPlayer(contentsOf: url)
            activeSound?.prepareToPlay()
            activeSound?.play()
        } catch { self.error = error.localizedDescription }
    }

    private var cookies: HTTPCookieStorage { .shared }
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = cookies
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.timeoutIntervalForRequest = 20
        return URLSession(configuration: config)
    }()

    func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Any {
        var req = URLRequest(url: base.appending(path: path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.message("No server response") }
        guard (200..<300).contains(http.statusCode) else {
            let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw APIError.message((payload?["message"] as? String) ?? "Server returned HTTP \(http.statusCode)")
        }
        return (try? JSONSerialization.jsonObject(with: data)) ?? NSNull()
    }

    func login() async {
        guard !username.trimmingCharacters(in: .whitespaces).isEmpty, !serialKey.isEmpty else {
            error = "Enter your username and access key."; return
        }
        busy = true; defer { busy = false }
        do {
            _ = try await request("/api/auth/login", method: "POST", body: ["username": username, "serialKey": serialKey])
            await refreshAll()
        } catch { self.error = error.localizedDescription }
    }

    func restoreSession() async {
        do {
            let value = try await request("/api/auth/me")
            currentUser = value as? [String: Any]
            if currentUser != nil { connected = true; await refreshAll() }
        } catch { connected = false }
    }

    func logout() async {
        _ = try? await request("/api/auth/logout", method: "POST")
        currentUser = nil; users = []; messages = []; connected = false
        poller?.cancel()
    }

    func refreshAll() async {
        do {
            let me = try await request("/api/auth/me")
            currentUser = me as? [String: Any]
            let list = try await request("/api/chat/users")
            users = list as? [[String: Any]] ?? []
            connected = true
            await refreshMessages()
            startPolling()
        } catch { self.error = error.localizedDescription; connected = false }
    }

    func refreshMessages() async {
        do {
            var path = "/api/messages"
            if let id = selectedUser?["id"] as? Int { path += "?recipientId=\(id)" }
            let value = try await request(path)
            messages = value as? [[String: Any]] ?? []
        } catch { self.error = error.localizedDescription }
    }

    func select(_ user: [String: Any]?) {
        selectedUser = user
        Task { await refreshMessages() }
    }

    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        var body: [String: Any] = ["content": text]
        if let id = selectedUser?["id"] as? Int { body["recipientId"] = id }
        draft = ""
        do { _ = try await request("/api/messages", method: "POST", body: body); await refreshMessages() }
        catch { self.error = error.localizedDescription; draft = text }
    }

    private func startPolling() {
        poller?.cancel()
        poller = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3))
                if Task.isCancelled { break }
                await refreshMessages()
            }
        }
    }
}

enum APIError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let value) = self { return value }; return "Unexpected error" }
}
