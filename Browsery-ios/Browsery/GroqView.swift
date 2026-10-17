import SwiftUI

/// Hey Groq: ask about the page you're on, or ask Browsery to open, search or find something. Tap to talk.
struct GroqView: View {
    @ObservedObject var tab: Tab
    let initialPrompt: String?

    @EnvironmentObject var store: Store
    @EnvironmentObject var browser: Browser
    @Environment(\.pal) private var pal
    @Environment(\.dismiss) private var dismiss
    @StateObject private var listener = Listener()

    struct Message: Identifiable {
        let id = UUID()
        enum Kind { case user, assistant, note, error }
        let kind: Kind
        let text: String
    }

    @State private var messages: [Message] = []
    @State private var input = ""
    @State private var thinking = false
    @State private var keyDraft = ""
    @FocusState private var focused: Bool

    private var chips: [String] {
        tab.url != nil ? ["Summarize this page", "Explain simpler", "Key facts as a list"] : ["Open Wikipedia", "Search for space news", "What can you do?"]
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            if store.groqKey.isEmpty {
                keySetup
            } else {
                conversation
                composer
            }
        }
        .background(
            ZStack {
                pal.void
                if pal.isSpace {
                    RadialGradient(colors: [pal.accent.opacity(0.1), .clear], center: UnitPoint(x: 0.5, y: 0.18), startRadius: 0, endRadius: 300)
                }
            }
            .ignoresSafeArea()
        )
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(pal.void)
        .onAppear {
            if let initialPrompt, !store.groqKey.isEmpty, messages.isEmpty { send(initialPrompt) }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "sparkle")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(pal.accent)
                .frame(width: 40, height: 40)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(pal.accentSoft))
            VStack(alignment: .leading, spacing: 2) {
                Text("Hey Groq").font(.system(size: 17, weight: .semibold))
                Text(tab.url != nil ? "Beside \(tab.host)" : "Ask anything, or ask Browsery to open a site")
                    .font(.system(size: 13))
                    .foregroundStyle(pal.inkMuted)
                    .lineLimit(1)
            }
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Close Hey Groq")
        }
        .foregroundStyle(pal.ink)
        .padding(.leading, 16)
        .padding(.trailing, 12)
        .padding(.top, 20)
        .padding(.bottom, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(pal.line).frame(height: 1) }
    }

    // MARK: First run: paste a key

    private var keySetup: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Connect Groq once")
                    .font(.system(size: 26, weight: .regular, design: .serif))
                    .foregroundStyle(pal.ink)
                Text("Hey Groq runs on your own free Groq key, so your questions go straight from this phone to Groq. Create a key, then paste it here. It's kept in the Keychain.")
                    .font(.system(size: 15))
                    .foregroundStyle(pal.inkMuted)
                Link(destination: URL(string: "https://console.groq.com/keys")!) {
                    Label("Get a free key at console.groq.com", systemImage: "arrow.up.right.square")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(pal.secondaryInk)
                }
                SecureField("Paste your key (gsk_…)", text: $keyDraft)
                    .font(.system(size: 16, design: .monospaced))
                    .foregroundStyle(pal.ink)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(.horizontal, 14)
                    .frame(height: 52)
                    .background(RoundedRectangle(cornerRadius: 14).fill(pal.canvas))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(pal.lineStrong, lineWidth: 1))
                Button {
                    store.groqKey = keyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                    if let initialPrompt, !store.groqKey.isEmpty { send(initialPrompt) }
                } label: {
                    Text("Save key")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(pal.onAccent)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(RoundedRectangle(cornerRadius: 14).fill(pal.accent))
                }
                .buttonStyle(PressStyle())
                .disabled(keyDraft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(20)
        }
    }

    // MARK: Conversation

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if messages.isEmpty {
                        Text(tab.url != nil ? "Ask about this page, or ask Browsery to open, search or find something." : "Ask anything, or ask Browsery to open a site or run a search.")
                            .font(.system(size: 15))
                            .foregroundStyle(pal.inkMuted)
                            .padding(.top, 8)
                    }
                    ForEach(messages) { m in bubble(m).id(m.id) }
                    if thinking {
                        HStack(spacing: 8) {
                            ProgressView().tint(pal.secondary)
                            Text("Thinking…").font(.system(size: 14)).foregroundStyle(pal.inkMuted)
                        }
                        .id("thinking")
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .onChange(of: messages.count) { _, _ in
                if let id = messages.last?.id { withAnimation { proxy.scrollTo(id, anchor: .bottom) } }
            }
            .onChange(of: thinking) { _, t in if t { withAnimation { proxy.scrollTo("thinking", anchor: .bottom) } } }
        }
    }

    @ViewBuilder
    private func bubble(_ m: Message) -> some View {
        switch m.kind {
        case .user:
            Text(m.text)
                .font(.system(size: 15))
                .foregroundStyle(pal.ink)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 16, bottomTrailingRadius: 4, topTrailingRadius: 16).fill(pal.surfaceMuted))
                .frame(maxWidth: 300, alignment: .trailing)
                .frame(maxWidth: .infinity, alignment: .trailing)
        case .assistant:
            Text(LocalizedStringKey(m.text))
                .font(.system(size: 15))
                .lineSpacing(3)
                .foregroundStyle(pal.ink)
                .textSelection(.enabled)
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 4, bottomTrailingRadius: 16, topTrailingRadius: 16).fill(pal.canvas))
                .overlay(UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 4, bottomTrailingRadius: 16, topTrailingRadius: 16).stroke(pal.secondary.opacity(0.22), lineWidth: 1))
                .shadow(color: pal.isSpace ? pal.secondary.opacity(0.06) : .clear, radius: 14)
                .frame(maxWidth: 340, alignment: .leading)
        case .note:
            Label(m.text, systemImage: "checkmark.circle")
                .font(.system(size: 13))
                .foregroundStyle(pal.secondaryInk)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 12).fill(pal.secondarySoft))
        case .error:
            Label(m.text, systemImage: "exclamationmark.triangle")
                .font(.system(size: 13))
                .foregroundStyle(pal.danger)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 12).stroke(pal.danger.opacity(0.4), lineWidth: 1))
        }
    }

    private var composer: some View {
        VStack(spacing: 12) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(chips, id: \.self) { c in
                        Button { send(c) } label: {
                            Text(c)
                                .font(.system(size: 14))
                                .foregroundStyle(pal.ink)
                                .padding(.horizontal, 14)
                                .frame(height: 40)
                                .background(Capsule().fill(pal.canvas))
                                .overlay(Capsule().stroke(pal.line, lineWidth: 1))
                        }
                        .buttonStyle(PressStyle())
                        .disabled(thinking)
                    }
                }
            }

            HStack(spacing: 8) {
                TextField("", text: $input, prompt: Text(listener.listening ? "Listening…" : (tab.url != nil ? "Ask about this page…" : "Ask Hey Groq…")).foregroundColor(pal.inkMuted), axis: .vertical)
                    .lineLimit(1...4)
                    .focused($focused)
                    .font(.system(size: 16))
                    .foregroundStyle(pal.ink)
                    .submitLabel(.send)
                    .onSubmit { send(input) }
                Button { send(input) } label: {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(input.isEmpty ? pal.inkMuted : pal.onAccent)
                        .frame(width: 44, height: 44)
                        .background(RoundedRectangle(cornerRadius: 10).fill(input.isEmpty ? pal.surfaceMuted : pal.accent))
                }
                .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || thinking)
                .accessibilityLabel("Send")
            }
            .padding(.leading, 16)
            .padding(.trailing, 6)
            .padding(.vertical, 4)
            .frame(minHeight: 52)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(pal.void))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(focused ? pal.secondary : pal.lineStrong, lineWidth: 1))

            if !focused {
                Button {
                    Haptic.tap()
                    listener.toggle { heard in send(heard) }
                } label: {
                    Image(systemName: listener.listening ? "stop.fill" : "mic.fill")
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(pal.onAccent)
                        .frame(width: 72, height: 72)
                        .background(Circle().fill(pal.accent))
                        .overlay(Circle().stroke(pal.accent.opacity(listener.listening ? 0.35 : 0.12), lineWidth: 8).padding(-8))
                        .shadow(color: pal.isSpace ? pal.accent.opacity(0.3) : .clear, radius: 20)
                        .symbolEffect(.pulse, isActive: listener.listening)
                }
                .buttonStyle(PressStyle())
                .padding(.top, 6)
                .accessibilityLabel(listener.listening ? "Stop listening" : "Tap to talk")
                Text(listener.problem ?? (listener.listening ? (listener.heard.isEmpty ? "Listening…" : listener.heard) : "Tap to talk"))
                    .font(.system(size: 13))
                    .foregroundStyle(listener.problem == nil ? pal.inkMuted : pal.danger)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(
            LinearGradient(colors: [pal.surface, pal.canvas], startPoint: .top, endPoint: .bottom)
                .overlay(alignment: .top) { Rectangle().fill(pal.line).frame(height: 1) }
                .ignoresSafeArea(edges: .bottom)
        )
    }

    // MARK: Asking

    private func send(_ raw: String) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !thinking else { return }
        input = ""
        messages.append(Message(kind: .user, text: text))
        thinking = true
        let history: [(role: String, text: String)] = messages.compactMap {
            switch $0.kind {
            case .user: return (role: "user", text: $0.text)
            case .assistant: return (role: "assistant", text: $0.text)
            default: return nil
            }
        }
        Task {
            let page = await tab.pageText()
            do {
                let reply = try await Groq.ask(key: store.groqKey, model: store.groqModel, history: history, page: page)
                thinking = false
                if !reply.text.isEmpty { messages.append(Message(kind: .assistant, text: reply.text)) }
                if let action = reply.action { perform(action) }
                if reply.text.isEmpty && reply.action == nil { messages.append(Message(kind: .error, text: "Groq didn't say anything. Try asking another way.")) }
            } catch {
                thinking = false
                messages.append(Message(kind: .error, text: error.localizedDescription))
            }
        }
    }

    private func perform(_ a: Groq.Action) {
        switch a.type {
        case "open_url":
            guard let u = URL(string: a.arg) else { return }
            messages.append(Message(kind: .note, text: "Opened \(u.host ?? a.arg) in a new tab"))
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
                dismiss()
                browser.newTab(url: u, isPrivate: tab.isPrivate)
            }
        case "web_search":
            messages.append(Message(kind: .note, text: "Searched for “\(a.arg)”"))
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
                dismiss()
                browser.newTab(url: store.searchURL(a.arg), isPrivate: tab.isPrivate)
            }
        case "find_in_page":
            guard tab.url != nil else {
                messages.append(Message(kind: .error, text: "Open a page first, then Hey Groq can find words on it."))
                return
            }
            messages.append(Message(kind: .note, text: "Finding “\(a.arg)” on the page"))
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                dismiss()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { tab.find(a.arg) }
            }
        case "new_tab":
            messages.append(Message(kind: .note, text: "Opened a new tab"))
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                dismiss()
                browser.newTab(isPrivate: tab.isPrivate)
            }
        default:
            break
        }
    }
}
