import UIKit

/// On-device preparation of a label photo for `POST /api/label-scan`:
/// longest side at most 1024 px (the same rule `backend/modules/label-scan`
/// applies, CLAUDE.md §7) and JPEG at quality 0.8 (implementation spec §12).
/// Resizing here rather than on the server keeps a 12 MP camera frame from
/// crossing the LAN at all.
enum LabelImage {
    static let maxPixelDimension: CGFloat = 1024
    static let jpegQuality: CGFloat = 0.8

    /// The pixel size an image of `pixelSize` is scaled to. Never upscales.
    static func targetPixelSize(for pixelSize: CGSize) -> CGSize {
        let longest = max(pixelSize.width, pixelSize.height)
        guard longest > maxPixelDimension, longest > 0 else { return pixelSize }
        let scale = maxPixelDimension / longest
        return CGSize(width: (pixelSize.width * scale).rounded(),
                      height: (pixelSize.height * scale).rounded())
    }

    static func jpegForUpload(_ image: UIImage) -> Data? {
        let pixelSize = CGSize(width: image.size.width * image.scale,
                               height: image.size.height * image.scale)
        guard pixelSize.width > 0, pixelSize.height > 0 else { return nil }
        let target = targetPixelSize(for: pixelSize)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        // draw(in:) applies the photo's EXIF orientation, so the upload is
        // upright regardless of how the phone was held.
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        return resized.jpegData(compressionQuality: jpegQuality)
    }
}
