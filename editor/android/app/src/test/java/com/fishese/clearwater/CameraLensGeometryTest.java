package com.fishese.clearwater;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class CameraLensGeometryTest {
    @Test public void physicalFieldOfViewExcludesDigitalStops() {
        // Representative wide, ultra-wide, short telephoto, and long
        // telephoto metadata from separate physical modules.
        assertEquals(1f, CameraLensGeometry.relativeZoom(6.3f, 9.792f, 6.3f, 9.792f), .001f);
        assertEquals(.61f, CameraLensGeometry.relativeZoom(6.3f, 9.792f, 2.2f, 5.6f), .02f);
        assertEquals(2.74f, CameraLensGeometry.relativeZoom(6.3f, 9.792f, 7.9f, 4.48f), .02f);
        assertEquals(5.06f, CameraLensGeometry.relativeZoom(6.3f, 9.792f, 18.6f, 5.712f), .02f);
    }

    @Test public void invalidSensorDataCannotBecomeAFalseOneTimesLens() {
        assertTrue(Float.isNaN(CameraLensGeometry.relativeZoom(6.3f, 9.792f, 0f, 5.6f)));
        assertTrue(Float.isNaN(CameraLensGeometry.relativeZoom(6.3f, 9.792f, 7.9f, Float.NaN)));
        assertTrue(Float.isNaN(CameraLensGeometry.opticalRatio(1f, Float.NaN)));
        assertEquals(5.06f, CameraLensGeometry.opticalRatio(1f, 5.06f), .001f);
        assertEquals(2.74f, CameraLensGeometry.opticalRatio(2.6f, 2.74f), .001f);
        assertEquals(.61f, CameraLensGeometry.opticalRatio(.61f, Float.NaN), .001f);
    }

    @Test public void physicalZoomCannotEscapeItsModuleRange() {
        float[] bounds=CameraLensGeometry.intersectZoomBounds(.6f,10f,1f,8f);
        assertArrayEquals(new float[]{1f,8f},bounds,.001f);
        assertEquals(1f,CameraLensGeometry.clampZoom(.6f,bounds),.001f);
        assertEquals(8f,CameraLensGeometry.clampZoom(10f,bounds),.001f);
        assertEquals(3f,CameraLensGeometry.clampZoom(3f,bounds),.001f);
        assertArrayEquals(new float[]{1f,10f},CameraLensGeometry.intersectZoomBounds(.6f,10f,1f,Float.POSITIVE_INFINITY),.001f);
    }
}
