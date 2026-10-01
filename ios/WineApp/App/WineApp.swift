import SwiftUI

@main
struct WineApp: App {
    @State private var session = AppSession()

    init() {
        AppFont.applyNavigationBarTitles()
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environment(session)
                .tint(Theme.accent)
        }
    }
}
