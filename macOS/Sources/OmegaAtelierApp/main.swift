import SwiftUI
import WebKit
import AppKit

private enum WebCommand: String {
    case back = "omega.web.back"
    case forward = "omega.web.forward"
    case reload = "omega.web.reload"
    case zoomIn = "omega.web.zoomIn"
    case zoomOut = "omega.web.zoomOut"
    case zoomReset = "omega.web.zoomReset"
}

final class WebViewStore: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    let webView: WKWebView

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
        webView.setValue(false, forKey: "drawsBackground")

        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        loadBundledApp()

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleCommand(_:)),
            name: nil,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private func loadBundledApp() {
        guard let indexURL = Bundle.module.url(forResource: "web/index", withExtension: "html") else {
            let html = """
            <html><body style="font-family:-apple-system;padding:40px;background:#070810;color:white">
            <h1>OMEGA Atelier</h1>
            <p>Web-Build fehlt. Bitte <code>./script/build_and_run.sh</code> ausführen.</p>
            </body></html>
            """
            webView.loadHTMLString(html, baseURL: nil)
            return
        }

        webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
    }

    @objc private func handleCommand(_ notification: Notification) {
        guard let command = WebCommand(rawValue: notification.name.rawValue) else { return }

        switch command {
        case .back:
            if webView.canGoBack { webView.goBack() }
        case .forward:
            if webView.canGoForward { webView.goForward() }
        case .reload:
            webView.reload()
        case .zoomIn:
            webView.pageZoom = min(webView.pageZoom + 0.1, 2.0)
        case .zoomOut:
            webView.pageZoom = max(webView.pageZoom - 0.1, 0.5)
        case .zoomReset:
            webView.pageZoom = 1.0
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["http", "https"].contains(url.scheme?.lowercased()) {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        if navigationAction.targetFrame == nil {
            if ["http", "https"].contains(url.scheme?.lowercased()) {
                NSWorkspace.shared.open(url)
            }
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }
}

@main
struct OmegaAtelierApp: App {
    @StateObject private var store = WebViewStore()

    var body: some Scene {
        WindowGroup("OMEGA Atelier") {
            ContentView(store: store)
                .frame(minWidth: 1100, minHeight: 720)
                .background(.black)
        }
        .windowResizability(.contentSize)
        .commands {
            CommandMenu("OMEGA") {
                Button("Zurück") {
                    post(.back)
                }
                .keyboardShortcut("[", modifiers: [.command])

                Button("Vor") {
                    post(.forward)
                }
                .keyboardShortcut("]", modifiers: [.command])

                Divider()

                Button("Neu laden") {
                    post(.reload)
                }
                .keyboardShortcut("r", modifiers: [.command])

                Divider()

                Button("Vergrößern") {
                    post(.zoomIn)
                }
                .keyboardShortcut("+", modifiers: [.command])

                Button("Verkleinern") {
                    post(.zoomOut)
                }
                .keyboardShortcut("-", modifiers: [.command])

                Button("Zoom zurücksetzen") {
                    post(.zoomReset)
                }
                .keyboardShortcut("0", modifiers: [.command])
            }
        }
    }

    private func post(_ command: WebCommand) {
        NotificationCenter.default.post(name: Notification.Name(command.rawValue), object: nil)
    }
}

struct ContentView: View {
    @ObservedObject var store: WebViewStore

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Button("Zurück") { post(.back) }
                    .help("Zur vorherigen Seite (⌘[)")

                Button("Vor") { post(.forward) }
                    .help("Zur nächsten Seite (⌘])")

                Button("Neu laden") { post(.reload) }
                    .help("Neu laden (⌘R)")

                Spacer()
            }
            .buttonStyle(.borderless)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(.ultraThinMaterial)

            OmegaWebView(store: store)
                .ignoresSafeArea(.container, edges: .bottom)
        }
    }

    private func post(_ command: WebCommand) {
        NotificationCenter.default.post(name: Notification.Name(command.rawValue), object: nil)
    }
}

struct OmegaWebView: NSViewRepresentable {
    @ObservedObject var store: WebViewStore

    func makeNSView(context: Context) -> WKWebView {
        store.webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {}
}
