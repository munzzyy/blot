import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    // The canvas can hold an unredacted page mid-session, and the app
    // switcher would otherwise thumbnail it. Android sets FLAG_SECURE,
    // which also blocks screenshots and screen recording; iOS has no
    // equivalent for either of those, so this only ever covers the
    // switcher thumbnail. Opaque, not blurred: a translucent shield still
    // lets shapes and dark ink show through.
    private let shield: UIView = {
        let view = UIView()
        view.backgroundColor = UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0x13 / 255, green: 0x11 / 255, blue: 0x18 / 255, alpha: 1)
                : UIColor(red: 0xf0 / 255, green: 0xee / 255, blue: 0xf6 / 255, alpha: 1)
        }
        return view
    }()

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // Whatever the save bridge wrote out for a previous share sheet is
        // done with by the next launch; mirrors Android's cleanup of its
        // own shared_out directory.
        let exports = FileManager.default.temporaryDirectory.appendingPathComponent("exports", isDirectory: true)
        try? FileManager.default.removeItem(at: exports)

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = ViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        guard let window, shield.superview == nil else { return }
        shield.frame = window.bounds
        shield.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        window.addSubview(shield)
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        shield.removeFromSuperview()
    }
}
