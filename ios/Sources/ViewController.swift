import UIKit
import SafariServices
import WebKit

// One screen: the bundled web app in a WKWebView on the fixed custom-scheme
// origin. The wrapper ships no networking code of its own; what the page can
// load is bounded by the CSP index.html carries.
final class ViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!

    // The app's own paper color, light and dark, so the safe-area letterbox
    // and the web view's own background match the page instead of showing
    // bare system chrome around it. Keep in sync with app/index.html's
    // theme-color meta tags and app/css/app.css's --paper token.
    private static let paperColor = UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0x13 / 255, green: 0x11 / 255, blue: 0x18 / 255, alpha: 1)
            : UIColor(red: 0xf0 / 255, green: 0xee / 255, blue: 0xf6 / 255, alpha: 1)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.paperColor
        excludeWebKitDataFromBackup()

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(AppSchemeHandler(), forURLScheme: AppSchemeHandler.scheme)
        config.websiteDataStore = .default()
        // The bridge the page uses to hand a finished export to the OS
        // share sheet. See userContentController(_:didReceive:) below.
        config.userContentController.add(self, name: "save")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = Self.paperColor
        // Kills the long-press link-preview popover: it fetches and
        // renders the target page itself, a remote load the navigation
        // policy below never gets a chance to gate.
        webView.allowsLinkPreview = false
        applyDynamicTypeZoom()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applyDynamicTypeZoom),
            name: UIContentSizeCategory.didChangeNotification,
            object: nil,
        )

        // Pinned to the safe area, deliberately not full-bleed. The page
        // declares viewport-fit=cover and pads its own bottom edge with
        // env(safe-area-inset-bottom) (app/css/app.css), which is exactly
        // right for Safari's own full-bleed handling of a Home Screen
        // install; going full-bleed here too would also need top and side
        // insets in every orientation this app supports, including the two
        // landscape ones where the notch sits on a side edge, and getting
        // that wrong would put toolbar buttons under it silently. Safe-area
        // pinning already handles all of that correctly with no page-side
        // cooperation needed, and the theme color below (not bare system
        // chrome) is what was actually wrong with it.
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
        ])

        webView.load(URLRequest(url: AppSchemeHandler.start))
    }

    // The system text-size setting reaches web content the way Android's
    // textZoom does: scale the page by the user's Dynamic Type factor.
    // Recomputed on every change, not just at launch, so adjusting text
    // size while the app is open takes effect immediately.
    @objc private func applyDynamicTypeZoom() {
        webView.pageZoom = UIFontMetrics(forTextStyle: .body).scaledValue(for: 17) / 17
    }

    // Real user data never lives here (Blot holds nothing between
    // sessions but a language preference), but every app in this family
    // gets this for consistency, and it costs nothing to apply.
    private func excludeWebKitDataFromBackup() {
        guard let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
        var webKitDir = library.appendingPathComponent("WebKit", isDirectory: true)
        guard (try? FileManager.default.createDirectory(at: webKitDir, withIntermediateDirectories: true)) != nil else { return }
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? webKitDir.setResourceValues(values)
    }

    // The web view only ever navigates inside the bundle; a link out goes to
    // the system's browser view. Gated hard: main-frame https navigations
    // from a real link tap, nothing else. Note this gate is satisfiable by
    // a synthetic element.click() on an anchor, which WebKit also reports
    // as .linkActivated; it stops navigation-by-script (location.replace,
    // redirects), not a page choosing to fake a user gesture on its own
    // anchor.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if url.scheme == AppSchemeHandler.scheme {
            decisionHandler(.allow)
            return
        }
        if url.scheme == "https",
           navigationAction.targetFrame?.isMainFrame != false,
           navigationAction.navigationType == .linkActivated {
            present(SFSafariViewController(url: url), animated: true)
        }
        decisionHandler(.cancel)
    }

    // window.open / target=_blank from the page: same rule as above, and
    // the same navigationType gate, so script cannot pop a browser view
    // for an arbitrary URL without a real tap behind it.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url,
           url.scheme == "https",
           navigationAction.navigationType == .linkActivated {
            present(SFSafariViewController(url: url), animated: true)
        }
        return nil
    }

    // The page's only way off the scheme: hand a finished export to the OS
    // share sheet. Body is { name, mime, b64 }, all strings; `name` is
    // sanitized to a bare filename before it ever touches the filesystem.
    // Written to a dedicated, cleaned-on-launch temp directory rather than
    // anywhere shared, and the share sheet's own "Save to Files" covers the
    // save case, so there is no separate save path to maintain.
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "save",
              let body = message.body as? [String: Any],
              let name = body["name"] as? String,
              let b64 = body["b64"] as? String,
              let data = Data(base64Encoded: b64)
        else { return }
        let safeName = sanitizeFilename(name)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("exports", isDirectory: true)
        guard (try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)) != nil else { return }
        let file = dir.appendingPathComponent(safeName)
        guard (try? data.write(to: file)) != nil else { return }
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY, width: 0, height: 0)
        }
        present(sheet, animated: true)
    }

    private func sanitizeFilename(_ name: String) -> String {
        let stripped = (name as NSString).lastPathComponent
        let safe = stripped.replacingOccurrences(of: "[^A-Za-z0-9._-]", with: "_", options: .regularExpression)
        let trimmed = String(safe.prefix(80))
        return trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "._")).isEmpty ? "export.pdf" : trimmed
    }
}
