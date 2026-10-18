package com.fishese.clearwater;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class HdrContainerTest {
    private static byte[] header(String brand) {
        byte[] bytes = new byte[20];
        bytes[3] = 20;
        System.arraycopy("ftyp".getBytes(StandardCharsets.US_ASCII), 0, bytes, 4, 4);
        System.arraycopy(brand.getBytes(StandardCharsets.US_ASCII), 0, bytes, 8, 4);
        return bytes;
    }

    @Test public void acceptsQuickTimeHeaderFromSuppliedSample() throws Exception {
        assertEquals(".mov", HdrContainer.extension(header("qt  ")));
    }

    @Test public void acceptsMp4IndependentOfSourceName() throws Exception {
        assertEquals(".mp4", HdrContainer.extension(header("isom")));
        assertEquals(".mp4", HdrContainer.extension(header("mp42")));
    }

    @Test public void acceptsPaddingAndCompatibleBrand() throws Exception {
        byte[] padded = new byte[32];
        padded[3] = 8;
        System.arraycopy("wide".getBytes(StandardCharsets.US_ASCII), 0, padded, 4, 4);
        byte[] ftyp = header("zzzz");
        System.arraycopy("isom".getBytes(StandardCharsets.US_ASCII), 0, ftyp, 16, 4);
        System.arraycopy(ftyp, 0, padded, 8, ftyp.length);
        assertEquals(".mp4", HdrContainer.extension(padded));
    }

    @Test public void acceptsExtendedFileTypeBox() throws Exception {
        byte[] bytes = new byte[24];
        bytes[3] = 1;
        System.arraycopy("ftyp".getBytes(StandardCharsets.US_ASCII), 0, bytes, 4, 4);
        bytes[15] = 24;
        System.arraycopy("qt  ".getBytes(StandardCharsets.US_ASCII), 0, bytes, 16, 4);
        assertEquals(".mov", HdrContainer.extension(bytes));
    }

    @Test public void rejectsUnsupportedOrTruncatedContainers() throws Exception {
        for (byte[] bytes : new byte[][] {header("heic"), new byte[12], "not a video".getBytes(StandardCharsets.US_ASCII)}) {
            try { HdrContainer.extension(bytes); fail("Expected an invalid container error"); }
            catch (IOException expected) { }
        }
    }
}
