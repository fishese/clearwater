import Foundation

// Codable equivalents of editor/src/core/types.ts. Keep raw values and keys aligned
// with the version-1 recipe JSON stored by the web editor.
struct NativeBalancedHints: Codable, Equatable {
    var scene: String = "auto"
    var water: String = "auto"
    var filter: String = "auto"
    var depth: Double? = nil

    private enum CodingKeys: String, CodingKey { case scene, water, filter, depth }
    init(scene: String = "auto", water: String = "auto", filter: String = "auto", depth: Double? = nil) {
        self.scene = scene; self.water = water; self.filter = filter; self.depth = depth
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        scene = try c.decode(String.self, forKey: .scene)
        water = try c.decode(String.self, forKey: .water)
        filter = try c.decode(String.self, forKey: .filter)
        depth = try c.decodeIfPresent(Double.self, forKey: .depth)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(scene, forKey: .scene); try c.encode(water, forKey: .water)
        try c.encode(filter, forKey: .filter)
        if let depth { try c.encode(depth, forKey: .depth) } else { try c.encodeNil(forKey: .depth) }
    }
}

struct NativeBalancedAnalysis: Codable, Equatable {
    var mean: [Double]; var neutral: [Double]
    var p05: Double; var p50: Double; var p95: Double
    var clipping: Double; var redRatio: Double; var magenta: Double
    var confidence: String
}

struct NativeBalancedSuggestion: Codable, Equatable {
    var gains: [Double]; var redMix: Double; var haze: Double; var highlights: Double
    var mode: String; var explanation: String
}

struct NativeBalancedAdjustments: Codable, Equatable {
    var warmth = 0.0; var tint = 0.0; var red = 0.0; var exposure = 0.0
    var highlights = 0.0; var shadows = 0.0; var contrast = 0.0; var haze = 0.0; var vibrance = 0.0
    var neutral: [Double] = [1, 1, 1]
}

struct NativeBalancedCustomModel: Codable, Equatable {
    var sha256: String; var name: String; var inputRange: String; var outputRange: String
}
struct NativeBalancedEnhancement: Codable, Equatable {
    var contrast: Double; var clarity: Double; var sharpness: Double; var black: Double; var white: Double
    var brightness: Double?; var autoApplied: Bool?
}
struct NativeBalancedAIFollowup: Codable, Equatable { var strength: Double }
struct NativeBalancedVideoCorrection: Codable, Equatable { var mode: String; var interval: Int; var referenceTime: Double }

struct NativeBalancedRecipe: Codable, Equatable {
    var version = 1
    var engine = "balanced"
    var strength: Double
    var hints: NativeBalancedHints
    var auto: NativeBalancedSuggestion
    var manual: NativeBalancedAdjustments
    var customModel: NativeBalancedCustomModel? = nil
    var enhancement: NativeBalancedEnhancement? = nil
    var balancedAfterAI: NativeBalancedAIFollowup? = nil
    var videoCorrection: NativeBalancedVideoCorrection? = nil
}

enum NativeBalancedMathError: Error { case invalidPixels, invalidDimensions, noNeutralPatch }

enum NativeBalancedMath {
    private static func clamp(_ v: Double, _ lo: Double = 0, _ hi: Double = 1) -> Double { min(hi, max(lo, v)) }
    private static func smooth(_ lo: Double, _ hi: Double, _ x: Double) -> Double {
        let t = clamp((x - lo) / (hi - lo)); return t * t * (3 - 2 * t)
    }
    private static func lum(_ r: Double, _ g: Double, _ b: Double) -> Double { 0.2126*r + 0.7152*g + 0.0722*b }
    private static func decode(_ v: Double) -> Double { v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
    private static func encode(_ v: Double) -> Double { v <= 0.0031308 ? 12.92*v : 1.055*pow(v, 1/2.4)-0.055 }
    // TypeScript stores these tables in Float32Array before indexing.
    private static let linearLUT = (0...4096).map { Double(Float(decode(Double($0) / 4096))) }
    private static let srgbLUT = (0...4096).map { Double(Float(encode(Double($0) / 4096))) }
    private static func toLinear(_ v: Double) -> Double { linearLUT[Int((clamp(v)*4096).rounded(.toNearestOrAwayFromZero))] }
    private static func toSrgb(_ v: Double) -> Double { srgbLUT[Int((clamp(v)*4096).rounded(.toNearestOrAwayFromZero))] }

    static func analyse(rgba: Data, width: Int, height: Int) throws -> NativeBalancedAnalysis {
        guard width > 0, height > 0 else { throw NativeBalancedMathError.invalidDimensions }
        guard rgba.count == width * height * 4 else { throw NativeBalancedMathError.invalidPixels }
        var sums = [Double](repeating: 0, count: 3), neutrals = sums
        var histogram = [Int](repeating: 0, count: 256), count = 0, neutralCount = 0, clipped = 0
        let step = max(1, max(width, height) / 384)
        rgba.withUnsafeBytes { raw in
            let p = raw.bindMemory(to: UInt8.self)
            for y in stride(from: 0, to: height, by: step) { for x in stride(from: 0, to: width, by: step) {
                let i = (y * width + x) * 4
                let r = Double(p[i]), g = Double(p[i+1]), b = Double(p[i+2]), a = p[i+3]
                if a < 128 { continue }
                let l = lum(r,g,b), hi = max(r,max(g,b)), lo = min(r,min(g,b))
                count += 1; sums[0] += r; sums[1] += g; sums[2] += b
                histogram[Int(l.rounded(.toNearestOrAwayFromZero))] += 1
                if hi >= 250 { clipped += 1 }
                if l > 25 && l < 225 && hi < 248 && (hi-lo)/max(hi,1) < 0.75 {
                    neutralCount += 1; neutrals[0] += r; neutrals[1] += g; neutrals[2] += b
                }
            }}
        }
        let mean = sums.map { $0 / Double(max(count,1)) }
        let neutral = neutralCount > Int(Double(count)*0.08) ? neutrals.map { $0 / Double(neutralCount) } : mean
        func percentile(_ q: Double) -> Double {
            var total = 0; for i in 0..<256 { total += histogram[i]; if total >= max(1, Int((Double(count)*q).rounded(.up))) { return Double(i)/255 } }; return 0
        }
        return NativeBalancedAnalysis(mean: mean, neutral: neutral, p05: percentile(0.05), p50: percentile(0.5), p95: percentile(0.95),
            clipping: Double(clipped)/Double(max(1,count)), redRatio: mean[0]/max(1,(mean[1]+mean[2])/2),
            magenta: (mean[0]+mean[2])/max(2,2*mean[1]), confidence: Double(neutralCount)>Double(count)*0.2 ? "medium" : "low")
    }

    static func suggest(analysis a: NativeBalancedAnalysis, hints: NativeBalancedHints) -> NativeBalancedSuggestion {
        let (r,g,b) = (a.mean[0],a.mean[1],a.mean[2])
        let filter = hints.filter == "yes" || (hints.filter == "auto" && (a.redRatio > 1.5 || (a.magenta > 1.55 && r > 80)))
        let surface = hints.scene == "surface", weakRed = clamp((0.8-a.redRatio)/0.8)
        var gains = [1.0,1.0,1.0], redMix = 0.0, mode = "gentle"
        if filter {
            let target = a.neutral.reduce(0,+)/3
            gains = a.neutral.map { clamp(pow(target/max($0,12),0.8),0.35,2.7) }
            let norm = lum(r,g,b)/max(1,lum(r*gains[0],g*gains[1],b*gains[2]))
            gains = gains.map { $0*norm }; mode = "filter"
        } else if !surface && weakRed > 0.08 {
            let depth = hints.depth.map { 0.75+0.4*clamp($0/30) } ?? 1
            let green = hints.water == "green" || (hints.water == "auto" && g > b*1.08)
            gains = [1+weakRed*1.2, green ? 0.86:1, green ? 1:0.85]
            redMix = weakRed*0.72*depth; mode = "restore"
        } else if !surface {
            let target = a.neutral.reduce(0,+)/3
            gains = a.neutral.map { clamp(pow(target/max(12,$0),0.35),0.85,1.2) }
        }
        let haze = !surface && a.p05 > 0.12 && a.p95-a.p05 < 0.6 ? clamp((a.p05-0.1)*0.5,0,0.09) : 0
        let highlights = a.clipping > 0.008 ? -0.12 : 0
        let explanation: String
        if filter { explanation = "Red / magenta cast detected. Balancing channels while keeping the scene’s brightness." }
        else if surface { explanation = "Surface mode keeps natural warm light. Fine-tune warmth and tint, or enable red-filter correction." }
        else if mode == "restore" { explanation = a.redRatio < 0.15 ? "Very little red remains. A conservative colour reconstruction is suggested; original colours are uncertain." : "Blue / green cast detected. Restoring warmth while preserving the water’s character." }
        else if haze > 0 { explanation = "Colour is fairly balanced. A little haze reduction is suggested." }
        else { explanation = "A gentle colour balance is suggested. Use manual controls to refine it." }
        return NativeBalancedSuggestion(gains:gains,redMix:redMix,haze:haze,highlights:highlights,mode:mode,explanation:explanation)
    }

    static func makeCameraRecipe(analysis: NativeBalancedAnalysis, strength: Double = 0.8, previous: NativeBalancedRecipe? = nil) -> NativeBalancedRecipe {
        let hints = NativeBalancedHints()
        let next = suggest(analysis: analysis, hints: hints)
        var auto = next
        if let old = previous?.auto {
            let blend = { (a: Double, b: Double) in a + (b-a)*0.3 }
            auto.gains = zip(old.gains,next.gains).map { blend($0.0,$0.1) }; auto.redMix = blend(old.redMix,next.redMix)
            auto.haze = blend(old.haze,next.haze); auto.highlights = blend(old.highlights,next.highlights)
        }
        return NativeBalancedRecipe(strength:clamp(strength),hints:hints,auto:auto,manual:previous?.manual ?? NativeBalancedAdjustments())
    }

    static func defaultCameraRecipe() -> NativeBalancedRecipe {
        let a = NativeBalancedAnalysis(mean:[128,128,128],neutral:[128,128,128],p05:0.5,p50:0.5,p95:0.5,clipping:0,redRatio:1,magenta:1,confidence:"low")
        return makeCameraRecipe(analysis:a)
    }

    /// Native video is already corrected in the rendered movie. Store it using the
    /// editor's neutral, zero-strength version-1 Balanced recipe after capture.
    static func editorRecipeAfterCapture() -> NativeBalancedRecipe {
        var recipe = defaultCameraRecipe()
        recipe.strength = 0
        recipe.manual = NativeBalancedAdjustments()
        return recipe
    }

    static func pickNeutral(patchRGBA: Data, recipe: NativeBalancedRecipe) throws -> NativeBalancedRecipe {
        guard !patchRGBA.isEmpty, patchRGBA.count % 4 == 0 else { throw NativeBalancedMathError.invalidPixels }
        var reset = recipe; reset.manual = NativeBalancedAdjustments()
        let rendered = try renderRGBA8(rgba:patchRGBA,width:patchRGBA.count/4,height:1,recipe:reset)
        var sum = [Double](repeating:0,count:3), n = 0
        rendered.withUnsafeBytes { raw in let p=raw.bindMemory(to:UInt8.self); for i in stride(from:0,to:rendered.count,by:4) where p[i+3] > 0 { for c in 0..<3 { sum[c] += Double(p[i+c]) }; n += 1 } }
        guard n > 0 else { throw NativeBalancedMathError.noNeutralPatch }
        let target = sum.map { $0/Double(n) }
        guard target.allSatisfy({ $0 >= 8 && $0 <= 245 }) else { throw NativeBalancedMathError.noNeutralPatch }
        let warmth=recipe.manual.warmth/100, tint=recipe.manual.tint/100, red=recipe.manual.red/100
        let other = [pow(2,warmth*0.45+red*0.8), pow(2,-tint*0.4), pow(2,-warmth*0.45)]
        var copy = recipe
        copy.manual.neutral = (0..<3).map { clamp(target.reduce(0,+)/3/max(target[$0],1)/other[$0],0.25,4) }
        return copy
    }

    static func recipeDictionary(_ recipe: NativeBalancedRecipe) throws -> [String: Any] {
        let data = try JSONEncoder().encode(recipe)
        return try JSONSerialization.jsonObject(with:data) as? [String:Any] ?? [:]
    }

    static func renderRGBA8(rgba: Data, width: Int, height: Int, recipe: NativeBalancedRecipe) throws -> Data {
        guard width > 0 && height > 0 else { throw NativeBalancedMathError.invalidDimensions }
        guard rgba.count == width*height*4 else { throw NativeBalancedMathError.invalidPixels }
        let a=recipe.auto,m=recipe.manual,s=clamp(recipe.strength)
        let warmth=m.warmth/100,tint=m.tint/100
        let gains=[m.neutral[0]*pow(2,warmth*0.45+m.red/100*0.8),m.neutral[1]*pow(2,-tint*0.4),m.neutral[2]*pow(2,-warmth*0.45)]
        let exposure=pow(2,m.exposure), haze=clamp(a.haze*s+m.haze/100*0.12,-0.1,0.18)
        let highlights=clamp(m.highlights/100+a.highlights*s,-1,1), shadows=m.shadows/100, contrast=1+m.contrast/100*0.65
        var out=Data(count:rgba.count)
        rgba.withUnsafeBytes { srcRaw in out.withUnsafeMutableBytes { dstRaw in
            let src=srcRaw.bindMemory(to:UInt8.self),dst=dstRaw.bindMemory(to:UInt8.self)
            for i in stride(from:0,to:rgba.count,by:4) {
                var r=Double(src[i])/255,g=Double(src[i+1])/255,b=Double(src[i+2])/255
                let or=toLinear(r),og=toLinear(g),ob=toLinear(b)
                let maxc=max(r,max(g,b)); let restored=clamp(r*a.gains[0]+a.redMix*max(0,g-0.3*b)*(1-0.45*smooth(0.65,1,maxc)))
                r=toSrgb(or*(1-s)+toLinear(restored)*s)
                g=toSrgb(og*(1-s)+toLinear(g*a.gains[1])*s)
                b=toSrgb(ob*(1-s)+toLinear(b*a.gains[2])*s)
                r=clamp(r*gains[0]);g=clamp(g*gains[1]);b=clamp(b*gains[2])
                var lr=toLinear(r)*exposure,lg=toLinear(g)*exposure,lb=toLinear(b)*exposure
                let l=lum(lr,lg,lb), adjusted=l*(1+highlights*0.65*smooth(0.18,0.95,l))+shadows*0.16*(1-smooth(0,0.5,l))
                let ratio=adjusted/max(l,0.00001);lr*=ratio;lg*=ratio;lb*=ratio
                r=toSrgb(lr);g=toSrgb(lg);b=toSrgb(lb)
                func veil(_ v:Double)->Double { clamp(((v-haze)/(1-haze)-0.5)*contrast+0.5) }
                r=veil(r);g=veil(g);b=veil(b)
                let y=lum(r,g,b),sat=max(r,max(g,b))-min(r,min(g,b)),vib=1+m.vibrance/100*0.8*(1-sat)
                dst[i]=UInt8((clamp(y+(r-y)*vib)*255).rounded(.toNearestOrEven));dst[i+1]=UInt8((clamp(y+(g-y)*vib)*255).rounded(.toNearestOrEven));dst[i+2]=UInt8((clamp(y+(b-y)*vib)*255).rounded(.toNearestOrEven));dst[i+3]=src[i+3]
            }
        }}
        return out
    }
}
