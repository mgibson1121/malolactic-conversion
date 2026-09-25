# iOS app (Phase 12)

Native SwiftUI client for the local backend. Spec: `docs/specs/2026-09-20-phase-12-mobile-ios.md`
(product) and `docs/specs/2026-09-20-phase-12-mobile-implementation.md` (build contract).

## Run it

1. Install Xcode 26 (App Store), then point the command-line tools at it once:
   `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
2. Start the backend from the repo root: `npm run dev:backend` (port 3000).
3. Open `ios/WineApp.xcodeproj`. For a physical phone, pick your team under
   *Signing & Capabilities*; the Simulator needs no signing.
4. Run. The Simulator talks to `http://localhost:3000` automatically. On a phone,
   the first launch asks for the Mac's LAN address (for example `192.168.1.20:3000`).
   The phone must be on the same Wi-Fi as the Mac. Phase 12 is LAN-only (decision D5).

Tests: **Product → Test** in Xcode, or
`xcodebuild test -project ios/WineApp.xcodeproj -scheme WineApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro'`.

## Keeping the models honest

`WineApp/Models/` mirrors `shared/types.ts` by hand. When that file changes,
update the Swift models in the same PR and regenerate the decoding fixtures:

```
npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json backend/scripts/export-ios-fixtures.ts
```

The fixtures are real storage-adapter output, so a renamed or added field shows up as a
failing `ModelDecodingTests` case, not as a silent decode gap on the phone.

## Layout

The project uses Xcode's synchronized folders: any file added under `WineApp/` or
`WineAppTests/` is part of the target automatically, with no `project.pbxproj` edit.

| Folder | Holds |
|---|---|
| `App/` | Entry point, tab shell, backend address (`AppSession`) |
| `Models/` | Codable mirrors of `shared/types.ts` |
| `Networking/` | `APIClient` (one method per route), `APIError`, on-device label resize |
| `State/` | `LoadState`, the six-state model every data view uses |
| `Logic/` | Pure derivations: readiness, critic badge, cellar summary, formatting |
| `Design/` | Colour tokens (light + dark) and type ramp |
| `Features/` | Screens |
