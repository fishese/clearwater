package com.fishese.clearwater;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Checks the ISO BMFF file type box before a staged video is passed to MediaExtractor. */
final class HdrContainer {
    private HdrContainer() { }

    private static long uint32(byte[] bytes, int at) {
        return ((long)(bytes[at] & 255) << 24) | ((long)(bytes[at + 1] & 255) << 16)
            | ((long)(bytes[at + 2] & 255) << 8) | (bytes[at + 3] & 255);
    }

    private static String fourcc(byte[] bytes, int at) {
        return new String(bytes, at, 4, StandardCharsets.US_ASCII);
    }

    private static String videoBrand(String brand) {
        if (brand.equals("qt  ")) return ".mov";
        if (brand.equals("isom") || brand.matches("iso[2-9A]") || brand.equals("mp41")
            || brand.equals("mp42") || brand.equals("avc1") || brand.equals("M4V ")
            || brand.equals("MSNV") || brand.equals("dash") || brand.startsWith("3gp")
            || brand.startsWith("3g2")) return ".mp4";
        return null;
    }

    static String extension(byte[] firstChunk) throws IOException {
        int offset = 0;
        // A few QuickTime files start with padding before the file-type box.
        while (offset + 16 <= firstChunk.length) {
            long size = uint32(firstChunk, offset);
            String type = fourcc(firstChunk, offset + 4);
            int header = 8;
            if (size == 1) {
                if (offset + 16 > firstChunk.length || uint32(firstChunk, offset + 8) != 0)
                    throw new IOException("The MP4/MOV video header is incomplete or invalid.");
                size = uint32(firstChunk, offset + 12);
                header = 16;
            }
            if (size < header || size > Integer.MAX_VALUE)
                throw new IOException("The MP4/MOV video header is incomplete or invalid.");
            if (type.equals("free") || type.equals("wide")) {
                if (size > firstChunk.length - offset)
                    throw new IOException("The MP4/MOV video header is incomplete or invalid.");
                offset += (int)size;
                continue;
            }
            if (!type.equals("ftyp") || size < header + 8 || offset + header + 8 > firstChunk.length)
                throw new IOException("Only MP4 and MOV video containers can be converted.");
            String major = fourcc(firstChunk, offset + header);
            if (major.equals("heic") || major.equals("heix") || major.equals("mif1")
                || major.equals("msf1") || major.equals("avif") || major.equals("avis"))
                throw new IOException("Only MP4 and MOV video containers can be converted.");
            String extension = videoBrand(major);
            if (extension != null) return extension;
            int end = (int)Math.min(firstChunk.length, Math.min(offset + size, offset + 4096L));
            for (int at = offset + header + 8; at + 4 <= end; at += 4) {
                extension = videoBrand(fourcc(firstChunk, at));
                if (extension != null) return extension;
            }
            throw new IOException("Only MP4 and MOV video containers can be converted.");
        }
        throw new IOException("The MP4/MOV video header is incomplete or invalid.");
    }
}
