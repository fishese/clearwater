package com.fishese.clearwater;

import android.hardware.camera2.CameraCharacteristics;
import android.util.SizeF;

/** Optical field-of-view comparison for two Camera2 camera modules. */
final class CameraLensGeometry {
    private CameraLensGeometry() {}

    static float opticalRatio(float cameraXRatio, float measuredRatio) {
        if (Float.isFinite(measuredRatio) && measuredRatio > 0) return measuredRatio;
        // CameraX reports 1 when it has no intrinsic-zoom metadata. That
        // default cannot establish that a separate module is a wide lens.
        return Float.isFinite(cameraXRatio) && cameraXRatio > 0 &&
            Math.abs(cameraXRatio - 1f) > .03f ? cameraXRatio : Float.NaN;
    }

    static float relativeZoom(CameraCharacteristics reference, CameraCharacteristics lens) {
        if (reference == null || lens == null) return Float.NaN;
        float[] referenceFocals = reference.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS);
        float[] lensFocals = lens.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS);
        SizeF referenceSensor = reference.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE);
        SizeF lensSensor = lens.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE);
        if (referenceFocals == null || referenceFocals.length == 0 ||
            lensFocals == null || lensFocals.length == 0 ||
            referenceSensor == null || lensSensor == null) return Float.NaN;
        return relativeZoom(referenceFocals[0], referenceSensor.getWidth(),
            lensFocals[0], lensSensor.getWidth());
    }

    static float relativeZoom(float referenceFocal, float referenceSensorWidth,
                              float lensFocal, float lensSensorWidth) {
        if (!Float.isFinite(referenceFocal) || !Float.isFinite(referenceSensorWidth) ||
            !Float.isFinite(lensFocal) || !Float.isFinite(lensSensorWidth) ||
            referenceFocal <= 0 || referenceSensorWidth <= 0 ||
            lensFocal <= 0 || lensSensorWidth <= 0) return Float.NaN;
        // tan(horizontal FOV / 2) = sensor width / (2 * focal length).
        float ratio = (lensFocal / lensSensorWidth) / (referenceFocal / referenceSensorWidth);
        return Float.isFinite(ratio) && ratio > 0 ? ratio : Float.NaN;
    }
}
