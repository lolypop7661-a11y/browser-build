import Foundation
import Security

struct Bookmark: Codable, Identifiable, Hashable {
    var id: String { url }
    var title: String
    var url: String
}

struct Visit: Codable, Identifiable, Hashable {
    var id = UUID()
    var title: String
    var url: String
    var date: Date
}

struct Shortcut: Codable, Identifiable, Hashable {
    var id: String { url }
    var name: String
    var url: String
}

/// Everything Browsery remembers on the phone. The Groq key lives in the Keychain, the rest in UserDefaults.
final class Store: ObservableObject {
    private let d = UserDefaults.standard

    static let engines = ["Browsery", "DuckDuckGo", "Bing", "Google"]
    static let models = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"]

    static let defaultShortcuts = [
        Shortcut(name: "YouTube", url: "https://m.youtube.com/"),
        Shortcut(name: "Wikipedia", url: "https://en.m.wikipedia.org/"),
        Shortcut(name: "GitHub", url: "https://github.com/"),
        Shortcut(name: "Gmail", url: "https://mail.google.com/"),
        Shortcut(name: "Reddit", url: "https://www.reddit.com/"),
        Shortcut(name: "News", url: "https://news.google.com/"),
        Shortcut(name: "Maps", url: "https://www.openstreetmap.org/"),
    ]

    @Published var engine: String { didSet { d.set(engine, forKey: "engine") } }
    @Published var suggestions: Bool { didSet { d.set(suggestions, forKey: "suggestions") } }
    @Published var shield: Bool { didSet { d.set(shield, forKey: "shield") } }
    @Published var httpsOnly: Bool { didSet { d.set(httpsOnly, forKey: "httpsOnly") } }
    @Published var chill: Bool { didSet { d.set(chill, forKey: "chill") } }
    @Published var groqModel: String { didSet { d.set(groqModel, forKey: "groqModel") } }
    @Published var groqKey: String { didSet { Keychain.set("groq-api-key", groqKey) } }
    @Published var bookmarks: [Bookmark] { didSet { save(bookmarks, "bookmarks") } }
    @Published var history: [Visit] { didSet { save(history, "history") } }
    @Published var shortcuts: [Shortcut] { didSet { save(shortcuts, "shortcuts") } }

    init() {
        let d = UserDefaults.standard
        engine = d.string(forKey: "engine") ?? "Browsery"
        suggestions = d.object(forKey: "suggestions") == nil ? true : d.bool(forKey: "suggestions")
        shield = d.object(forKey: "shield") == nil ? true : d.bool(forKey: "shield")
        httpsOnly = d.object(forKey: "httpsOnly") == nil ? true : d.bool(forKey: "httpsOnly")
        chill = d.object(forKey: "chill") == nil ? false : d.bool(forKey: "chill")
        groqModel = d.string(forKey: "groqModel") ?? "openai/gpt-oss-120b"
        groqKey = Keychain.get("groq-api-key") ?? ""
        bookmarks = Store.load("bookmarks", d) ?? []
        history = Store.load("history", d) ?? []
        shortcuts = Store.load("shortcuts", d) ?? Store.defaultShortcuts
    }

    private func save<T: Encodable>(_ value: T, _ key: String) {
        if let data = try? JSONEncoder().encode(value) { d.set(data, forKey: key) }
    }

    private static func load<T: Decodable>(_ key: String, _ d: UserDefaults) -> T? {
        guard let data = d.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    var engineLabel: String { engine == "Browsery" ? "Browsery Search (Mojeek)" : engine }

    func searchURL(_ query: String) -> URL {
        let base: String
        switch engine {
        case "DuckDuckGo": base = "https://duckduckgo.com/"
        case "Bing": base = "https://www.bing.com/search"
        case "Google": base = "https://www.google.com/search"
        default: base = "https://www.mojeek.com/search"
        }
        var c = URLComponents(string: base)!
        c.queryItems = [URLQueryItem(name: "q", value: query)]
        return c.url!
    }

    /// Turns what someone typed into a web address: a real address, a bare domain, or a search.
    func resolve(_ input: String) -> URL? {
        let t = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return nil }
        if !t.contains(" "), let u = URL(string: t), let s = u.scheme?.lowercased(), ["http", "https"].contains(s), u.host != nil {
            return u
        }
        if !t.contains(" "), t.range(of: #"^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#].*)?$"#, options: .regularExpression) != nil,
           let u = URL(string: "https://" + t) {
            return u
        }
        return searchURL(t)
    }

    func isBookmarked(_ url: URL?) -> Bool {
        guard let s = url?.absoluteString else { return false }
        return bookmarks.contains { $0.url == s }
    }

    func toggleBookmark(url: URL, title: String) {
        let s = url.absoluteString
        if let i = bookmarks.firstIndex(where: { $0.url == s }) {
            bookmarks.remove(at: i)
        } else {
            bookmarks.insert(Bookmark(title: title.isEmpty ? (url.host ?? s) : title, url: s), at: 0)
        }
    }

    func addVisit(url: URL, title: String) {
        let s = url.absoluteString
        guard s.hasPrefix("http") else { return }
        if let first = history.first, first.url == s {
            history[0].title = title.isEmpty ? first.title : title
            return
        }
        var h = history
        h.insert(Visit(title: title.isEmpty ? (url.host ?? s) : title, url: s, date: Date()), at: 0)
        if h.count > 400 { h.removeLast(h.count - 400) }
        history = h
    }

    /// Up to five matches from bookmarks and history for the address bar.
    func matches(_ text: String) -> [Bookmark] {
        let q = text.trimmingCharacters(in: .whitespaces).lowercased()
        guard suggestions, q.count >= 1 else { return [] }
        var seen = Set<String>()
        var out: [Bookmark] = []
        let pool = bookmarks + history.map { Bookmark(title: $0.title, url: $0.url) }
        for b in pool where (b.title.lowercased().contains(q) || b.url.lowercased().contains(q)) && !seen.contains(b.url) {
            seen.insert(b.url)
            out.append(b)
            if out.count == 5 { break }
        }
        return out
    }
}

/// Minimal Keychain wrapper for the Groq key.
enum Keychain {
    private static let service = "app.browsery.ios"

    static func get(_ account: String) -> String? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func set(_ account: String, _ value: String) {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary)
        let v = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !v.isEmpty else { return }
        var add = base
        add[kSecValueData as String] = Data(v.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }
}
