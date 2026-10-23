package com.fishese.clearwater;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class CaptureFilenameTest {
    @Test public void appendsOnlyTheRequestedCollisionSuffix() {
        assertEquals("CW_20250102_030405_2.jpg", CaptureFilename.withCollisionSuffix("CW_20250102_030405.jpg", 2));
        assertEquals("CW_20250102_030405_3.jpg", CaptureFilename.withCollisionSuffix("CW_20250102_030405_2.jpg", 3));
    }

    @Test(expected = IllegalArgumentException.class)
    public void doesNotSuffixLegacyNames() {
        CaptureFilename.withCollisionSuffix("ClearWater_existing.jpg", 1);
    }
}
