import CoreGraphics
import CoreImage
import CoreVideo
import ImageIO
import Metal
import XCTest
@testable import App

final class NativeBalancedParityTests: XCTestCase {
    private struct FixtureFile: Decodable { let cases: [Fixture] }
    private struct Fixture: Decodable {
        let name: String; let width: Int; let height: Int
        let input: String; let analysis: NativeBalancedAnalysis; let auto: NativeBalancedSuggestion
        let recipe: NativeBalancedRecipe; let rendered: String; let replacementPatch: String
        let replacementNeutral: [Double]?
        let smoothing: Smoothing
    }
    private struct Smoothing: Decodable {
        let previous: NativeBalancedRecipe; let strength: Double
        let hints: NativeBalancedHints; let manual: NativeBalancedAdjustments; let auto: NativeBalancedSuggestion
    }

    private func fixtures() throws -> [Fixture] {
        guard let url = Bundle(for: Self.self).url(forResource: "balanced-parity-fixtures", withExtension: "json") else {
            XCTFail("balanced-parity-fixtures.json must be included in AppTests resources")
            return []
        }
        return try JSONDecoder().decode(FixtureFile.self, from: Data(contentsOf: url)).cases
    }

    func testAnalysisSuggestionRenderAndReplacementMatchTypeScript() throws {
        for fixture in try fixtures() {
            let input = try XCTUnwrap(Data(base64Encoded: fixture.input))
            let analysis = try NativeBalancedMath.analyse(rgba: input, width: fixture.width, height: fixture.height)
            for (actual, expected) in zip(analysis.mean + analysis.neutral + [analysis.p05,analysis.p50,analysis.p95,analysis.clipping,analysis.redRatio,analysis.magenta],
                                          fixture.analysis.mean + fixture.analysis.neutral + [fixture.analysis.p05,fixture.analysis.p50,fixture.analysis.p95,fixture.analysis.clipping,fixture.analysis.redRatio,fixture.analysis.magenta]) {
                XCTAssertLessThanOrEqual(abs(actual-expected), 1e-6, "\(fixture.name) analysis")
            }
            XCTAssertEqual(analysis.confidence, fixture.analysis.confidence, fixture.name)
            let suggestion = NativeBalancedMath.suggest(analysis: analysis, hints: fixture.recipe.hints)
            XCTAssertEqual(suggestion.mode, fixture.auto.mode, fixture.name)
            XCTAssertEqual(suggestion.explanation, fixture.auto.explanation, fixture.name)
            for (actual, expected) in zip(suggestion.gains + [suggestion.redMix,suggestion.haze,suggestion.highlights], fixture.auto.gains + [fixture.auto.redMix,fixture.auto.haze,fixture.auto.highlights]) {
                XCTAssertLessThanOrEqual(abs(actual-expected), 1e-6, "\(fixture.name) suggestion")
            }
            let rendered = try NativeBalancedMath.renderRGBA8(rgba: input, width: fixture.width, height: fixture.height, recipe: fixture.recipe)
            let expected = try XCTUnwrap(Data(base64Encoded: fixture.rendered))
            XCTAssertEqual(rendered.count, expected.count)
            for i in 0..<rendered.count {
                XCTAssertLessThanOrEqual(abs(Int(rendered[i])-Int(expected[i])), 1, "\(fixture.name) CPU byte \(i)")
            }
            if let expectedNeutral = fixture.replacementNeutral {
                let patch = try XCTUnwrap(Data(base64Encoded: fixture.replacementPatch))
                let picked = try NativeBalancedMath.pickNeutral(patchRGBA: patch, recipe: fixture.recipe)
                for (actual, expected) in zip(picked.manual.neutral, expectedNeutral) {
                    XCTAssertLessThanOrEqual(abs(actual-expected), 1e-6, "\(fixture.name) replacement neutral")
                }
            }
            let smoothed = NativeBalancedMath.makeCameraRecipe(analysis: analysis, strength: 0.6, previous: fixture.smoothing.previous)
            XCTAssertEqual(smoothed.strength, fixture.smoothing.strength, accuracy: 1e-6, fixture.name)
            XCTAssertEqual(smoothed.hints, fixture.smoothing.hints, fixture.name)
            XCTAssertEqual(smoothed.manual, fixture.smoothing.manual, fixture.name)
            XCTAssertEqual(smoothed.auto.mode, fixture.smoothing.auto.mode, fixture.name)
            XCTAssertEqual(smoothed.auto.explanation, fixture.smoothing.auto.explanation, fixture.name)
            for (actual, expected) in zip(smoothed.auto.gains + [smoothed.auto.redMix,smoothed.auto.haze,smoothed.auto.highlights], fixture.smoothing.auto.gains + [fixture.smoothing.auto.redMix,fixture.smoothing.auto.haze,fixture.smoothing.auto.highlights]) {
                XCTAssertLessThanOrEqual(abs(actual-expected), 1e-6, "\(fixture.name) smoothing")
            }
        }
    }

    func testMetalRenderMatchesTypeScriptWithinThreeBytes() throws {
        guard MTLCreateSystemDefaultDevice() != nil else { throw XCTSkip("Metal is unavailable on this test device") }
        let processor = try ClearWaterBalancedProcessor()
        for fixture in try fixtures() {
            let bytes = try XCTUnwrap(Data(base64Encoded: fixture.input))
            let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
            let provider = CGDataProvider(data: bytes as CFData)!
            let cgImage = CGImage(width: fixture.width, height: fixture.height, bitsPerComponent: 8, bitsPerPixel: 32,
                bytesPerRow: fixture.width*4, space: colorSpace, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue),
                provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
            let source = CIImage(cgImage: cgImage)
            var output: CVPixelBuffer?
            let attrs: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String:fixture.width,kCVPixelBufferHeightKey as String:fixture.height,
                kCVPixelBufferIOSurfacePropertiesKey as String:[:],kCVPixelBufferMetalCompatibilityKey as String:true]
            XCTAssertEqual(CVPixelBufferCreate(kCFAllocatorDefault, fixture.width, fixture.height, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &output), kCVReturnSuccess)
            let dst = try XCTUnwrap(output)
            try processor.render(source: source, into: dst, recipe: fixture.recipe)
            CVPixelBufferLockBaseAddress(dst, .readOnly); defer { CVPixelBufferUnlockBaseAddress(dst, .readOnly) }
            let base = CVPixelBufferGetBaseAddress(dst)!.assumingMemoryBound(to: UInt8.self)
            let rowBytes = CVPixelBufferGetBytesPerRow(dst)
            let expected = try XCTUnwrap(Data(base64Encoded: fixture.rendered))
            for y in 0..<fixture.height { for x in 0..<fixture.width {
                let src = (y*fixture.width+x)*4, got = y*rowBytes+x*4
                let alpha = Int(expected[src+3])
                XCTAssertLessThanOrEqual(abs(Int(base[got+3])-alpha), 1, "\(fixture.name) alpha")
                if alpha > 0 {
                    XCTAssertLessThanOrEqual(abs(Int(base[got+2])-Int(expected[src])), 3, "\(fixture.name) red")
                    XCTAssertLessThanOrEqual(abs(Int(base[got+1])-Int(expected[src+1])), 3, "\(fixture.name) green")
                    XCTAssertLessThanOrEqual(abs(Int(base[got])-Int(expected[src+2])), 3, "\(fixture.name) blue")
                }
            }}
        }
    }
}
