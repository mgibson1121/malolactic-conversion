import SwiftUI

@main
struct WineApp: App {
    @State private var session = AppSession()

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environment(session)
                .tint(Theme.accent)
        }
    }
}
