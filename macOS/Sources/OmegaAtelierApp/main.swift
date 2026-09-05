import SwiftUI
import WebKit

@main
struct OmegaAtelierApp: App {
    var body: some Scene {
        WindowGroup("OMEGA Atelier") {
            ContentView()
                .frame(minWidth: 1100, minHeight: 720)
        }
        .windowResizability(.contentSize)
    }
}

struct ContentView: View {
    var body: some View {
        OmegaWebView()
            .ignoresSafeArea(.container, edges: .bottom)
    }
}

struct OmegaWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
        webView.setValue(false, forKey: "drawsBackground")

        if let indexURL = Bundle.module.url(forResource: "web/index", withExtension: "html") {
            webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
        } else {
            let html = """
            <html><body style=\"font-family:-apple-system;padding:40px\">
            <h1>OMEGA Atelier</h1>
            <p>Web build fehlt. Bitte <code>./script/build_and_run.sh</code> ausführen.</p>
            </body></html>
            """
            webView.loadHTMLString(html, baseURL: nil)
        }

        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {}
}
