#include <metal_stdlib>
using namespace metal;

struct Uniforms {
    float4 autoGains;
    float4 cameraColourR;
    float4 cameraColourG;
    float4 cameraColourB;
    float4 cameraColourEnabled;
    float4 manualGains;
    float4 controls; // strength, redMix, exposure multiplier, haze
    float4 tonal;    // highlights, shadows, contrast, vibrance
};

inline float clamp01(float x) { return clamp(x, 0.0f, 1.0f); }
inline float smooth(float lo, float hi, float x) {
    float t = clamp01((x-lo)/(hi-lo)); return t*t*(3.0f-2.0f*t);
}
inline float transfer(texture2d<float, access::read> lut, float v) {
    uint i = uint(floor(clamp01(v) * 4096.0f + 0.5f)); return lut.read(uint2(i,0)).r;
}
inline float srgb(texture2d<float, access::read> lut, float v) {
    uint i = uint(floor(clamp01(v) * 4096.0f + 0.5f)); return lut.read(uint2(i,1)).r;
}
inline float lum(float3 c) { return dot(c,float3(0.2126f,0.7152f,0.0722f)); }

kernel void clearWaterBalanced(texture2d<float, access::read> source [[texture(0)]],
                               texture2d<float, access::write> destination [[texture(1)]],
                               constant Uniforms& u [[buffer(0)]],
                               texture2d<float, access::read> lut [[texture(2)]],
                               uint2 p [[thread_position_in_grid]]) {
    if (p.x >= source.get_width() || p.y >= source.get_height()) return;
    float4 pixel = source.read(p);
    float3 c = pixel.rgb;
    float3 originalLinear = float3(transfer(lut,c.r),transfer(lut,c.g),transfer(lut,c.b));
    float3 restored;
    if (u.cameraColourEnabled.x > 0.5f) {
        float4 affineInput = float4(c, 1.0f);
        restored = clamp(float3(dot(u.cameraColourR, affineInput), dot(u.cameraColourG, affineInput), dot(u.cameraColourB, affineInput)), 0.0f, 1.0f);
    } else {
        float mx=max(c.r,max(c.g,c.b));
        float red=clamp01(c.r*u.autoGains.x+u.controls.y*max(0.0f,c.g-0.3f*c.b)*(1.0f-0.45f*smooth(0.65f,1.0f,mx)));
        restored = float3(red, c.g*u.autoGains.y, c.b*u.autoGains.z);
    }
    float3 autoLinear=float3(transfer(lut,restored.r),transfer(lut,restored.g),transfer(lut,restored.b));
    float3 blended=mix(originalLinear,autoLinear,u.controls.x);
    c=float3(srgb(lut,blended.x),srgb(lut,blended.y),srgb(lut,blended.z));
    c=clamp(c*u.manualGains.xyz,0.0f,1.0f);
    float3 linear=float3(transfer(lut,c.r),transfer(lut,c.g),transfer(lut,c.b))*u.controls.z;
    float y=lum(linear);
    float adjusted=y*(1.0f+u.tonal.x*0.65f*smooth(0.18f,0.95f,y))+u.tonal.y*0.16f*(1.0f-smooth(0.0f,0.5f,y));
    linear *= adjusted/max(y,0.00001f);
    c=float3(srgb(lut,linear.r),srgb(lut,linear.g),srgb(lut,linear.b));
    c=clamp(((c-u.controls.w)/(1.0f-u.controls.w)-0.5f)*u.tonal.z+0.5f,0.0f,1.0f);
    y=lum(c); float sat=max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b));
    float vib=1.0f+u.tonal.w*(1.0f-sat);
    c=clamp(float3(y)+(c-float3(y))*vib,0.0f,1.0f);
    destination.write(float4(c,pixel.a),p);
}
