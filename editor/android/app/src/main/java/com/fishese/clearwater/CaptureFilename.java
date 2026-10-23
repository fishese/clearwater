package com.fishese.clearwater;

final class CaptureFilename {
    private CaptureFilename() {}

    static String withCollisionSuffix(String filename, int suffix) {
        if (suffix < 1) throw new IllegalArgumentException("Invalid collision suffix.");
        int dot = filename.lastIndexOf('.');
        if (dot <= 0) throw new IllegalArgumentException("Invalid capture filename.");
        String stem = filename.substring(0, dot), extension = filename.substring(dot);
        if (!stem.matches("CW_\\d{8}_\\d{6}(?:_\\d+)?")) throw new IllegalArgumentException("Only timestamped capture names can be numbered.");
        stem = stem.replaceFirst("_\\d+$", "");
        return stem + "_" + suffix + extension;
    }
}
