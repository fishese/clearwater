import CoreImage
import CoreVideo
import Metal

enum ClearWaterProcessorError: Error {
    case metalUnavailable, kernelUnavailable, unsupportedPixelBuffer, invalidRecipe
}

/// Converts the camera CIImage through an explicit SDR sRGB boundary, then applies
/// the same Balanced recipe used by the CPU reference and photo/video rendering.
final class ClearWaterBalancedProcessor {
    private let device: MTLDevice
    private let queue: MTLCommandQueue
    private let pipeline: MTLComputePipelineState
    private let textureCache: CVMetalTextureCache
    private let context: CIContext
    private let lutTexture: MTLTexture
    private let poolLock = NSLock()
    private var pools: [String: CVPixelBufferPool] = [:]
    private var poolOrder: [String] = []

    static var isAvailable: Bool { (try? ClearWaterBalancedProcessor()) != nil }

    /// Release cached intermediate IOSurfaces after a full-resolution still or on memory warning.
    func purgeIntermediatePools() {
        poolLock.lock(); defer { poolLock.unlock() }
        pools.removeAll(keepingCapacity: false); poolOrder.removeAll(keepingCapacity: false)
    }

    init() throws {
        guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
            throw ClearWaterProcessorError.metalUnavailable
        }
        guard let library = device.makeDefaultLibrary(), let function = library.makeFunction(name: "clearWaterBalanced") else {
            throw ClearWaterProcessorError.kernelUnavailable
        }
        let linearValues = (0...4096).map { i -> Float in
            let v = Double(i) / 4096
            return Float(v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4))
        }
        let srgbValues = (0...4096).map { i -> Float in
            let v = Double(i) / 4096
            return Float(v <= 0.0031308 ? 12.92*v : 1.055*pow(v, 1/2.4)-0.055)
        }
        let lutDescriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .r32Float, width: 4097, height: 2, mipmapped: false)
        lutDescriptor.storageMode = .shared; lutDescriptor.usage = .shaderRead
        guard let lutTexture = device.makeTexture(descriptor: lutDescriptor) else { throw ClearWaterProcessorError.kernelUnavailable }
        linearValues.withUnsafeBytes { lutTexture.replace(region: MTLRegionMake2D(0, 0, 4097, 1), mipmapLevel: 0, withBytes: $0.baseAddress!, bytesPerRow: 4097 * MemoryLayout<Float>.size) }
        srgbValues.withUnsafeBytes { lutTexture.replace(region: MTLRegionMake2D(0, 1, 4097, 1), mipmapLevel: 0, withBytes: $0.baseAddress!, bytesPerRow: 4097 * MemoryLayout<Float>.size) }
        do { pipeline = try device.makeComputePipelineState(function: function) }
        catch { throw ClearWaterProcessorError.kernelUnavailable }
        var cache: CVMetalTextureCache?
        guard CVMetalTextureCacheCreate(kCFAllocatorDefault, nil, device, nil, &cache) == kCVReturnSuccess,
              let cache else { throw ClearWaterProcessorError.metalUnavailable }
        self.device = device; self.queue = queue; self.textureCache = cache; self.lutTexture = lutTexture
        self.context = CIContext(mtlDevice: device, options: [
            .workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
            .outputColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
            .cacheIntermediates: false
        ])
    }

    /// `into` must be a BGRA8, IOSurface-backed buffer owned by the caller's bounded pool.
    func render(source: CIImage, into output: CVPixelBuffer, recipe: NativeBalancedRecipe) throws {
        guard CVPixelBufferGetPixelFormatType(output) == kCVPixelFormatType_32BGRA else { throw ClearWaterProcessorError.unsupportedPixelBuffer }
        let width = CVPixelBufferGetWidth(output), height = CVPixelBufferGetHeight(output)
        guard width > 0, height > 0, recipe.version == 1, recipe.engine == "balanced", recipe.auto.gains.count == 3,
              recipe.manual.neutral.count == 3, recipe.hasValidCameraColour() else { throw ClearWaterProcessorError.invalidRecipe }
        guard let input = makeIntermediate(width: width, height: height) else { throw ClearWaterProcessorError.unsupportedPixelBuffer }

        // Core Image reads camera color attachments and normalizes wide-gamut/YCbCr
        // sources into encoded sRGB here. The kernel then operates on that SDR image.
        let normalized = source.transformed(by: CGAffineTransform(translationX: -source.extent.origin.x, y: -source.extent.origin.y))
        context.render(normalized, to: input, bounds: CGRect(x: 0, y: 0, width: width, height: height), colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
        setSRGBAttachments(input); setSRGBAttachments(output)
        var srcRef: CVMetalTexture?; var dstRef: CVMetalTexture?
        guard CVMetalTextureCacheCreateTextureFromImage(kCFAllocatorDefault, textureCache, input, nil, .bgra8Unorm, width, height, 0, &srcRef) == kCVReturnSuccess,
              CVMetalTextureCacheCreateTextureFromImage(kCFAllocatorDefault, textureCache, output, nil, .bgra8Unorm, width, height, 0, &dstRef) == kCVReturnSuccess,
              let src = srcRef.flatMap(CVMetalTextureGetTexture), let dst = dstRef.flatMap(CVMetalTextureGetTexture),
              let command = queue.makeCommandBuffer(), let encoder = command.makeComputeCommandEncoder() else {
            throw ClearWaterProcessorError.unsupportedPixelBuffer
        }
        var u = Uniforms(recipe: recipe)
        encoder.setComputePipelineState(pipeline)
        encoder.setTexture(src, index: 0); encoder.setTexture(dst, index: 1)
        encoder.setBytes(&u, length: MemoryLayout<Uniforms>.stride, index: 0)
        encoder.setTexture(lutTexture, index: 2)
        let w = pipeline.threadExecutionWidth, h = max(1, pipeline.maxTotalThreadsPerThreadgroup / w)
        encoder.dispatchThreads(MTLSize(width: width, height: height, depth: 1), threadsPerThreadgroup: MTLSize(width: w, height: h, depth: 1))
        encoder.endEncoding()
        command.commit(); command.waitUntilCompleted()
        if let error = command.error { throw error }
        CVMetalTextureCacheFlush(textureCache, 0)
    }

    private func makeIntermediate(width: Int, height: Int) -> CVPixelBuffer? {
        let key = "\(width)x\(height)"
        poolLock.lock(); defer { poolLock.unlock() }
        if pools[key] == nil {
            if poolOrder.count >= 2 { pools.removeValue(forKey: poolOrder.removeFirst()) }
            let attrs: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
                kCVPixelBufferIOSurfacePropertiesKey as String: [:], kCVPixelBufferMetalCompatibilityKey as String: true]
            var pool: CVPixelBufferPool?
            CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, attrs as CFDictionary, &pool)
            pools[key] = pool
            poolOrder.append(key)
        }
        var buffer: CVPixelBuffer?
        if let pool = pools[key] {
            CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(kCFAllocatorDefault, pool,
                [kCVPixelBufferPoolAllocationThresholdKey as String: 2] as CFDictionary, &buffer)
        }
        return buffer
    }

    private func setSRGBAttachments(_ buffer: CVPixelBuffer) {
        CVBufferSetAttachment(buffer, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(buffer, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_sRGB, .shouldPropagate)
    }
}

private struct Uniforms {
    var autoGains: SIMD4<Float>
    var cameraColourR: SIMD4<Float>
    var cameraColourG: SIMD4<Float>
    var cameraColourB: SIMD4<Float>
    var cameraColourEnabled: SIMD4<Float>
    var manualGains: SIMD4<Float>
    var controls: SIMD4<Float> // strength, redMix, exposure multiplier, haze
    var tonal: SIMD4<Float> // highlights, shadows, contrast, vibrance
    init(recipe: NativeBalancedRecipe) {
        let m = recipe.manual, s = recipe.strength
        let warmth = m.warmth / 100, tint = m.tint / 100
        autoGains = SIMD4(Float(recipe.auto.gains[0]),Float(recipe.auto.gains[1]),Float(recipe.auto.gains[2]),0)
        if let matrix = recipe.cameraColour?.matrix, matrix.count == 12 {
            cameraColourR = SIMD4(Float(matrix[0]),Float(matrix[1]),Float(matrix[2]),Float(matrix[3]))
            cameraColourG = SIMD4(Float(matrix[4]),Float(matrix[5]),Float(matrix[6]),Float(matrix[7]))
            cameraColourB = SIMD4(Float(matrix[8]),Float(matrix[9]),Float(matrix[10]),Float(matrix[11]))
            cameraColourEnabled = SIMD4(1,0,0,0)
        } else {
            cameraColourR = .zero; cameraColourG = .zero; cameraColourB = .zero
            cameraColourEnabled = .zero
        }
        manualGains = SIMD4(Float(m.neutral[0] * pow(2,warmth*0.45+m.red/100*0.8)),Float(m.neutral[1]*pow(2,-tint*0.4)),Float(m.neutral[2]*pow(2,-warmth*0.45)),0)
        controls = SIMD4(Float(s),Float(recipe.auto.redMix),Float(pow(2,m.exposure)),Float(min(0.18,max(-0.1,recipe.auto.haze*s+m.haze/100*0.12))))
        tonal = SIMD4(Float(min(1,max(-1,m.highlights/100+recipe.auto.highlights*s))),Float(m.shadows/100),Float(1+m.contrast/100*0.65),Float(m.vibrance/100*0.8))
    }
}
