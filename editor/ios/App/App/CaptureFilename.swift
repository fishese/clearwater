import Foundation

enum CaptureFilename {
    static func format(date: Date, extension ext: String, collisionSuffix: Int = 0,
                       timeZone: TimeZone = .current) -> String {
        precondition(ext == "jpg" || ext == "mp4")
        precondition(collisionSuffix >= 0)
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "en_US_POSIX")
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        let stamp = String(format: "%04d%02d%02d_%02d%02d%02d", locale: Locale(identifier: "en_US_POSIX"),
                           parts.year!, parts.month!, parts.day!, parts.hour!, parts.minute!, parts.second!)
        return "CW_\(stamp)\(collisionSuffix == 0 ? "" : "_\(collisionSuffix)").\(ext)"
    }
}
