package com.fishese.clearwater;

import android.content.Context;
import android.opengl.GLES20;
import androidx.media3.common.VideoFrameProcessingException;
import androidx.media3.common.util.GlProgram;
import androidx.media3.common.util.GlUtil;
import androidx.media3.common.util.Size;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.effect.BaseGlShaderProgram;
import androidx.media3.effect.GlEffect;
import java.io.IOException;
import org.json.JSONArray;
import org.json.JSONObject;

/** Frozen Balanced camera correction for CameraX preview and video output. */
@UnstableApi
final class CameraRecipeEffect implements GlEffect {
    private static final String VERTEX =
        "attribute vec4 aFramePosition;\n" +
        "attribute vec4 aTexCoord;\n" +
        "uniform mat4 uTransformationMatrix;\n" +
        "uniform mat4 uTexTransformationMatrix;\n" +
        "varying vec2 vTexSamplingCoord;\n" +
        "void main(){ gl_Position=uTransformationMatrix*aFramePosition; vTexSamplingCoord=(uTexTransformationMatrix*aTexCoord).xy; }";

    /* Media3's SDR working texture is linear BT.709. Convert it to the sRGB domain
       used by the web camera shader, run the same recipe, then return linear pixels. */
    private static final String FRAGMENT =
        "precision highp float;\n" +
        "uniform sampler2D uTexSampler;\n" +
        "uniform vec3 uAutoGains; uniform mat4 uCameraColour; uniform float uHasCameraColour;\n" +
        "uniform vec3 uManualGains; uniform float uRedMix; uniform float uStrength;\n" +
        "uniform float uHaze; uniform float uHighlights; uniform float uExposure;\n" +
        "uniform float uShadows; uniform float uContrast; uniform float uVibrance;\n" +
        "varying vec2 vTexSamplingCoord;\n" +
        "float linearChannel(float c){return c<=0.04045?c/12.92:pow((c+0.055)/1.055,2.4);}\n" +
        "float srgbChannel(float c){c=max(c,0.0);return c<=0.0031308?c*12.92:1.055*pow(c,1.0/2.4)-0.055;}\n" +
        "float lum(vec3 c){return dot(c,vec3(0.2126,0.7152,0.0722));}\n" +
        "void main(){\n" +
        " vec3 original=vec3(srgbChannel(texture2D(uTexSampler,vTexSamplingCoord).r),srgbChannel(texture2D(uTexSampler,vTexSamplingCoord).g),srgbChannel(texture2D(uTexSampler,vTexSamplingCoord).b));\n" +
        " float peak=max(original.r,max(original.g,original.b));\n" +
        " float red=clamp(original.r*uAutoGains.r+uRedMix*max(0.0,original.g-0.3*original.b)*(1.0-0.45*smoothstep(0.65,1.0,peak)),0.0,1.0);\n" +
        " vec3 balanced=vec3(red,original.g*uAutoGains.g,original.b*uAutoGains.b);\n" +
        " vec3 aiColour=(uCameraColour*vec4(original,1.0)).rgb;\n" +
        " vec3 restored=clamp(mix(balanced,aiColour,uHasCameraColour),0.0,1.0);\n" +
        " vec3 blended=vec3(srgbChannel(linearChannel(original.r)*(1.0-uStrength)+linearChannel(restored.r)*uStrength),srgbChannel(linearChannel(original.g)*(1.0-uStrength)+linearChannel(restored.g)*uStrength),srgbChannel(linearChannel(original.b)*(1.0-uStrength)+linearChannel(restored.b)*uStrength));\n" +
        " vec3 color=clamp(blended*uManualGains,0.0,1.0);\n" +
        " vec3 linearColor=vec3(linearChannel(color.r),linearChannel(color.g),linearChannel(color.b))*uExposure;\n" +
        " float l=lum(linearColor); float adjusted=l*(1.0+uHighlights*0.65*smoothstep(0.18,0.95,l))+uShadows*0.16*(1.0-smoothstep(0.0,0.5,l));\n" +
        " linearColor*=adjusted/max(l,0.00001); color=vec3(srgbChannel(linearColor.r),srgbChannel(linearColor.g),srgbChannel(linearColor.b));\n" +
        " color=clamp(((color-vec3(uHaze))/(1.0-uHaze)-0.5)*uContrast+0.5,0.0,1.0);\n" +
        " float y=lum(color); float saturation=max(color.r,max(color.g,color.b))-min(color.r,min(color.g,color.b));\n" +
        " color=clamp(vec3(y)+(color-vec3(y))*(1.0+uVibrance*0.8*(1.0-saturation)),0.0,1.0);\n" +
        " gl_FragColor=vec4(linearChannel(color.r),linearChannel(color.g),linearChannel(color.b),1.0);\n" +
        "}";

    private final float[] autoGains, manualGains, cameraColour;
    private final float redMix, strength, haze, highlights, exposure, shadows, contrast, vibrance, hasCameraColour;

    CameraRecipeEffect(JSONObject recipe) {
        JSONObject auto = recipe == null ? null : recipe.optJSONObject("auto");
        JSONObject manual = recipe == null ? null : recipe.optJSONObject("manual");
        autoGains = vector(auto == null ? null : auto.optJSONArray("gains"), new float[]{1,1,1});
        float[] neutral = vector(manual == null ? null : manual.optJSONArray("neutral"), new float[]{1,1,1});
        float warmth = number(manual, "warmth", 0) / 100f;
        float red = number(manual, "red", 0) / 100f;
        float tint = number(manual, "tint", 0) / 100f;
        manualGains = new float[]{
            neutral[0] * (float)Math.pow(2, warmth * .45f + red * .8f),
            neutral[1] * (float)Math.pow(2, -tint * .4f),
            neutral[2] * (float)Math.pow(2, -warmth * .45f)
        };
        float recipeStrength = recipe == null ? 0 : (float)recipe.optDouble("strength", 0);
        strength = clamp(recipeStrength, 0, 1);
        float manualHaze = number(manual, "haze", 0) / 100f * .12f;
        haze = clamp(number(auto, "haze", 0) * strength + manualHaze, -.1f, .18f);
        highlights = clamp(number(manual, "highlights", 0) / 100f + number(auto, "highlights", 0) * strength, -1, 1);
        exposure = (float)Math.pow(2, number(manual, "exposure", 0));
        shadows = number(manual, "shadows", 0) / 100f;
        contrast = 1 + number(manual, "contrast", 0) / 100f * .65f;
        vibrance = number(manual, "vibrance", 0) / 100f;
        redMix = number(auto, "redMix", 0);
        JSONArray matrix = recipe == null ? null : recipe.optJSONObject("cameraColour") == null ? null : recipe.optJSONObject("cameraColour").optJSONArray("matrix");
        if (matrix != null && matrix.length() == 12) {
            float[] rowMajor = vector(matrix, new float[12]);
            cameraColour = new float[]{rowMajor[0],rowMajor[4],rowMajor[8],0,rowMajor[1],rowMajor[5],rowMajor[9],0,rowMajor[2],rowMajor[6],rowMajor[10],0,rowMajor[3],rowMajor[7],rowMajor[11],1};
            hasCameraColour = 1;
        } else {
            cameraColour = new float[]{1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1};
            hasCameraColour = 0;
        }
    }

    @Override public BaseGlShaderProgram toGlShaderProgram(Context context, boolean useHdr) throws VideoFrameProcessingException {
        if (useHdr) throw new VideoFrameProcessingException(new IllegalArgumentException("Balanced camera correction currently requires SDR preview."));
        return new Program(context, this);
    }

    private static final class Program extends BaseGlShaderProgram {
        private final CameraRecipeEffect recipe;
        private final GlProgram gl;
        Program(Context context, CameraRecipeEffect recipe) throws VideoFrameProcessingException {
            super(false, 1); this.recipe = recipe;
            try { gl = new GlProgram(VERTEX, FRAGMENT); }
            catch (GlUtil.GlException e) { throw new VideoFrameProcessingException(e); }
            gl.setBufferAttribute("aFramePosition", GlUtil.getNormalizedCoordinateBounds(), GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE);
            gl.setBufferAttribute("aTexCoord", GlUtil.getTextureCoordinateBounds(), GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE);
            float[] identity = GlUtil.create4x4IdentityMatrix();
            gl.setFloatsUniform("uTransformationMatrix", identity); gl.setFloatsUniform("uTexTransformationMatrix", identity);
        }
        @Override public Size configure(int width, int height) { return new Size(width, height); }
        @Override public void drawFrame(int inputTexId, long presentationTimeUs) throws VideoFrameProcessingException {
            try {
                gl.use(); gl.setSamplerTexIdUniform("uTexSampler", inputTexId, 0);
                gl.setFloatsUniform("uAutoGains", recipe.autoGains); gl.setFloatsUniform("uManualGains", recipe.manualGains);
                gl.setFloatsUniform("uCameraColour", recipe.cameraColour); gl.setFloatUniform("uHasCameraColour", recipe.hasCameraColour);
                gl.setFloatUniform("uRedMix", recipe.redMix); gl.setFloatUniform("uStrength", recipe.strength);
                gl.setFloatUniform("uHaze", recipe.haze); gl.setFloatUniform("uHighlights", recipe.highlights);
                gl.setFloatUniform("uExposure", recipe.exposure); gl.setFloatUniform("uShadows", recipe.shadows);
                gl.setFloatUniform("uContrast", recipe.contrast); gl.setFloatUniform("uVibrance", recipe.vibrance);
                gl.bindAttributesAndUniforms(); GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
            } catch (GlUtil.GlException e) { throw new VideoFrameProcessingException(e, presentationTimeUs); }
        }
        @Override public void release() throws VideoFrameProcessingException {
            super.release(); try { gl.delete(); } catch (GlUtil.GlException e) { throw new VideoFrameProcessingException(e); }
        }
    }

    private static float number(JSONObject object, String key, float fallback) { return object == null ? fallback : (float)object.optDouble(key, fallback); }
    private static float[] vector(JSONArray array, float[] fallback) {
        if (array == null || array.length() != fallback.length) return fallback.clone();
        float[] values = new float[fallback.length]; for (int i=0;i<values.length;i++) values[i]=(float)array.optDouble(i, fallback[i]); return values;
    }
    private static float clamp(float value, float min, float max) { return Math.max(min, Math.min(max, value)); }
}
