import SwiftUI
import UIKit

private let bg = Color(red: 0.035, green: 0.035, blue: 0.075)
private let panel = Color(red: 0.075, green: 0.065, blue: 0.12)
private let purple = Color(red: 0.61, green: 0.39, blue: 0.98)

struct RootView: View {
    @EnvironmentObject var model: NexusModel
    @State private var section = "Messages"
    @AppStorage("nexus.wallpaper") private var wallpaper = "NexusWallpaperViolet"

    var body: some View {
        GeometryReader { geometry in
            Group {
                if model.currentUser == nil {
                    LoginView()
                } else if geometry.size.width >= 1050 {
                    ipadLayout
                } else {
                    phoneLayout
                }
            }
        }
        .background { ZStack { Image(wallpaper).resizable().scaledToFill().ignoresSafeArea(); bg.opacity(0.84).ignoresSafeArea() } }
        .task { if model.currentUser == nil { await model.restoreSession() } }
        .alert("NEXUS", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK", role: .cancel) { model.error = nil }
        } message: { Text(model.error ?? "") }
    }

    private var ipadLayout: some View {
        HStack(spacing: 0) {
            sidebar.frame(width: 220)
            Divider().overlay(purple.opacity(0.18))
            conversationList.frame(width: 270)
            Divider().overlay(purple.opacity(0.18))
            chatPanel.frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider().overlay(purple.opacity(0.18))
            toolsPanel.frame(width: 220)
        }
        .padding(10)
        .background(bg)
    }

    private var phoneLayout: some View {
        TabView(selection: $section) {
            NavigationStack { conversationList.navigationTitle("NEXUS SERVER") }
                .tabItem { Label("Chats", systemImage: "bubble.left.and.bubble.right") }.tag("Messages")
            NavigationStack { chatPanel.navigationTitle("Messages") }
                .tabItem { Label("Chat", systemImage: "message") }.tag("Chat")
            NavigationStack { toolsPanel.navigationTitle("Tools") }
                .tabItem { Label("Tools", systemImage: "waveform") }.tag("Tools")
            NavigationStack { sidebar.navigationTitle("NEXUS") }
                .tabItem { Label("More", systemImage: "square.grid.2x2") }.tag("More")
        }
        .tint(purple)
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "cpu").font(.title2).foregroundStyle(.white)
                    .frame(width: 42, height: 42).background(purple.opacity(0.3), in: RoundedRectangle(cornerRadius: 14))
                VStack(alignment: .leading, spacing: 2) {
                    Text("N E X U S").font(.system(size: 16, weight: .black, design: .rounded))
                    Text("YOUR DIGITAL UNIVERSE").font(.system(size: 8, design: .monospaced)).foregroundStyle(.secondary)
                }
            }.padding(.vertical, 12)
            navRow("Personal Workspace", icon: "sparkles")
            Text("WORKSPACE").font(.system(size: 9, weight: .bold, design: .monospaced)).foregroundStyle(.secondary).padding(.top, 12)
            navRow("Net Proxy", icon: "globe")
            navRow("Messages", icon: "message", active: true)
            navRow("Servers", icon: "server")
            navRow("History", icon: "clock")
            navRow("Update Logs", icon: "doc.text")
            Spacer()
            navRow("Settings", icon: "gearshape")
            HStack {
                Image(systemName: "person.crop.circle.fill").font(.title2).foregroundStyle(purple)
                VStack(alignment: .leading) {
                    Text((model.currentUser?["username"] as? String) ?? "USER").font(.caption.bold())
                    Text("USER · ONLINE").font(.system(size: 9, design: .monospaced)).foregroundStyle(.green)
                }
                Spacer()
                Button { Task { await model.logout() } } label: { Image(systemName: "rectangle.portrait.and.arrow.right") }.tint(.secondary)
            }.padding(10).background(panel, in: RoundedRectangle(cornerRadius: 12))
        }
        .padding(12).background(Color.black.opacity(0.18))
    }

    private var conversationList: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { Text("NEXUS SERVER").font(.system(size: 11, weight: .bold, design: .monospaced)); Spacer(); Image(systemName: "plus.square") }
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                Text("Find a conversation or person…").font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
            }.padding(10).background(.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 6))
            HStack { Text("GROUP CHATS").font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary); Spacer() }
            Text("No groups yet.").font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary)
            Text("DIRECT MESSAGES").font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary).padding(.top, 10)
            ScrollView {
                LazyVStack(spacing: 6) {
                    ForEach(users.indices, id: \.self) { index in
                        let user = users[index]
                        Button { model.select(user); section = "Chat" } label: {
                            HStack(spacing: 10) {
                                Circle().fill((user["presenceStatus"] as? String) == "online" ? .green : .gray).frame(width: 8, height: 8)
                                Text((user["displayName"] as? String) ?? (user["username"] as? String) ?? "USER")
                                    .font(.system(size: 11, design: .monospaced)).lineLimit(1)
                                Spacer()
                            }.padding(11).background(isSelected(user) ? purple.opacity(0.2) : .black.opacity(0.28), in: RoundedRectangle(cornerRadius: 4))
                                .overlay(RoundedRectangle(cornerRadius: 4).stroke(purple.opacity(isSelected(user) ? 0.7 : 0.16)))
                        }.buttonStyle(.plain)
                    }
                }
            }
        }.padding(12).background(.black.opacity(0.22))
    }

    private var users: [[String: Any]] { model.users.filter { ($0["id"] as? Int) != (model.currentUser?["id"] as? Int) } }
    private func isSelected(_ user: [String: Any]) -> Bool { (user["id"] as? Int) == (model.selectedUser?["id"] as? Int) }
    private func navRow(_ title: String, icon: String, active: Bool = false) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).frame(width: 20)
            Text(title).font(.system(size: 12, weight: active ? .bold : .medium))
            Spacer()
            if active { Circle().fill(.green).frame(width: 6, height: 6) }
        }.foregroundStyle(active ? .white : .white.opacity(0.55))
            .padding(11).background(active ? purple.opacity(0.22) : .clear, in: RoundedRectangle(cornerRadius: 9))
    }

    private var chatPanel: some View {
        VStack(spacing: 0) {
            HStack {
                Circle().fill(purple).frame(width: 8, height: 8)
                Text((model.selectedUser?["username"] as? String ?? "GENERAL").uppercased())
                    .font(.system(size: 12, weight: .bold, design: .monospaced)).tracking(2)
                Spacer()
                Label("AES-256 SESSION", systemImage: "lock.shield").font(.system(size: 8, design: .monospaced)).foregroundStyle(.green)
            }.padding(15).background(panel)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        ForEach(model.messages.indices, id: \.self) { index in
                            let message = model.messages[index]
                            messageRow(message).id(index)
                        }
                    }.padding(16)
                }.onChange(of: model.messages.count) { _ in
                    if !model.messages.isEmpty { proxy.scrollTo(model.messages.count - 1, anchor: .bottom) }
                }
            }
            HStack(spacing: 10) {
                Image(systemName: "plus").foregroundStyle(.secondary)
                TextField("Transmit a message…", text: $model.draft, axis: .vertical)
                    .lineLimit(1...4).font(.system(size: 14))
                    .onSubmit { Task { await model.send() } }
                Button { Task { await model.send() } } label: {
                    Image(systemName: "paperplane.fill").foregroundStyle(.white).padding(12)
                        .background(purple, in: RoundedRectangle(cornerRadius: 10))
                }
            }.padding(10).background(panel, in: RoundedRectangle(cornerRadius: 14)).padding(10)
        }.background(bg)
    }

    private func messageRow(_ message: [String: Any]) -> some View {
        let sender = (message["senderName"] as? String) ?? "NEXUS USER"
        let mine = sender.caseInsensitiveCompare((model.currentUser?["username"] as? String) ?? "") == .orderedSame
        let content = (message["content"] as? String) ?? ""
        return HStack(alignment: .bottom) {
            if mine { Spacer(minLength: 45) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
                Text(mine ? "YOU" : sender.uppercased()).font(.system(size: 9, weight: .bold, design: .monospaced)).foregroundStyle(.white.opacity(0.65))
                Text(content).font(.system(size: 14)).padding(12)
                    .background(mine ? purple.opacity(0.18) : panel, in: RoundedRectangle(cornerRadius: 13))
                    .overlay(RoundedRectangle(cornerRadius: 13).stroke(purple.opacity(0.45)))
            }
            if !mine { Spacer(minLength: 45) }
        }
    }

    private var toolsPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("DIAGNOSTIC_LOG", systemImage: "terminal").font(.system(size: 10, weight: .bold, design: .monospaced)).tracking(2)
            RoundedRectangle(cornerRadius: 9).fill(panel).overlay(alignment: .topLeading) {
                Text(model.connected ? "Connected to NEXUS\nSession active\nMessages syncing…" : "Waiting for connection…")
                    .font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary).padding(12)
            }.frame(minHeight: 170)
            Label("SOUNDBOARD", systemImage: "speaker.wave.2").font(.system(size: 10, weight: .bold, design: .monospaced)).tracking(2)
            let sounds: [(String, String)] = [
                ("NEURAL PING", "NeuralPing"), ("GLITCH PULSE", "GlitchPulse"),
                ("DATA EXTRACT", "DataExtract"), ("SYS ALARM", "SystemAlarm"),
                ("STATIC BURST", "StaticBurst"), ("VOID BEEP", "VoidBeep"),
                ("PROTOCOL INIT", "ProtocolInit"), ("TERMINATE", "Terminate")
            ]
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(sounds, id: \.1) { sound in
                    Button { model.playSound(sound.1) } label: {
                        Text(sound.0).font(.system(size: 8, design: .monospaced)).foregroundStyle(.white.opacity(0.85)).padding(10).frame(maxWidth: .infinity).background(panel).overlay(Rectangle().stroke(purple.opacity(0.25)))
                    }
                }
            }
            Label("WALLPAPER STUDIO", systemImage: "photo.on.rectangle.angled").font(.system(size: 10, weight: .bold, design: .monospaced)).tracking(2).padding(.top, 8)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(["NexusWallpaperViolet", "NexusWallpaperMidnight", "NexusWallpaperAmethyst", "NexusWallpaperAurora", "NexusWallpaperEmber"], id: \.self) { name in
                    Button { wallpaper = name } label: {
                        ZStack(alignment: .bottomLeading) {
                            Image(name).resizable().scaledToFill().frame(height: 58).clipped()
                            Text(name.replacingOccurrences(of: "NexusWallpaper", with: "").uppercased()).font(.system(size: 7, weight: .bold, design: .monospaced)).padding(5).frame(maxWidth: .infinity, alignment: .leading).background(.black.opacity(0.55))
                            if wallpaper == name { Image(systemName: "checkmark.circle.fill").foregroundStyle(.white).padding(5).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing) }
                        }.clipShape(RoundedRectangle(cornerRadius: 7)).overlay(RoundedRectangle(cornerRadius: 7).stroke(wallpaper == name ? purple : .white.opacity(0.15), lineWidth: wallpaper == name ? 2 : 1))
                    }.buttonStyle(.plain)
                }
            }
            Spacer()
        }.padding(14).background(.black.opacity(0.2))
    }
}

struct LoginView: View {
    @EnvironmentObject var model: NexusModel
    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "cpu").font(.system(size: 42)).foregroundStyle(purple)
            Text("N E X U S").font(.system(size: 25, weight: .black, design: .rounded)).tracking(4)
            Text("SECURE DIGITAL NETWORK").font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
            TextField("Username", text: $model.username).textInputAutocapitalization(.never).autocorrectionDisabled().padding(14).background(panel, in: RoundedRectangle(cornerRadius: 10))
            SecureField("Access key", text: $model.serialKey).padding(14).background(panel, in: RoundedRectangle(cornerRadius: 10))
            Button { Task { await model.login() } } label: {
                HStack { if model.busy { ProgressView() }; Text("CONNECT TO NEXUS") }
                    .font(.system(size: 12, weight: .bold, design: .monospaced)).frame(maxWidth: .infinity).padding(15)
                    .background(purple, in: RoundedRectangle(cornerRadius: 10))
            }.disabled(model.busy)
        }.padding(28).frame(maxWidth: 430).frame(maxWidth: .infinity, maxHeight: .infinity).background(bg)
    }
}
