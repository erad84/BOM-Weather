var pako = require('./vendor/pako.min.js');

var CRC_TABLE = (function () {
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function concat() {
  var total = 0;
  for (var i = 0; i < arguments.length; i++) total += arguments[i].length;
  var out = new Uint8Array(total);
  var off = 0;
  for (var j = 0; j < arguments.length; j++) {
    out.set(arguments[j], off);
    off += arguments[j].length;
  }
  return out;
}

function chunk(type, data) {
  var typeBytes = new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]);
  var body = concat(typeBytes, data);
  var crc = crc32(body);
  return concat(new Uint8Array(u32(data.length)), body, new Uint8Array(u32(crc)));
}

function pebbleIndex(r, g, b) {
  function q(v) {
    var n = Math.round(v / 85);
    if (n < 0) n = 0;
    if (n > 3) n = 3;
    return n;
  }
  return (q(r) << 4) | (q(g) << 2) | q(b);
}

function paletteRgb() {
  var pal = new Uint8Array(64 * 3);
  for (var i = 0; i < 64; i++) {
    pal[i * 3] = ((i >> 4) & 3) * 85;
    pal[i * 3 + 1] = ((i >> 2) & 3) * 85;
    pal[i * 3 + 2] = (i & 3) * 85;
  }
  return pal;
}

function extractRect(src, sw, sh, x0, y0, cw, ch) {
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x0 + cw > sw) cw = sw - x0;
  if (y0 + ch > sh) ch = sh - y0;
  if (cw < 1) cw = 1;
  if (ch < 1) ch = 1;
  var dst = new Uint8Array(cw * ch * 4);
  var y;
  for (y = 0; y < ch; y++) {
    var srcOff = ((y0 + y) * sw + x0) * 4;
    dst.set(src.subarray(srcOff, srcOff + cw * 4), y * cw * 4);
  }
  return { rgba: dst, w: cw, h: ch };
}

function fitContainRgba(src, sw, sh, dw, dh) {
  var dst = new Uint8Array(dw * dh * 4);
  var i;
  for (i = 0; i < dst.length; i += 4) {
    dst[i] = 255;
    dst[i + 1] = 255;
    dst[i + 2] = 255;
    dst[i + 3] = 255;
  }
  var scale = Math.min(dw / sw, dh / sh);
  var rw = Math.max(1, Math.round(sw * scale));
  var rh = Math.max(1, Math.round(sh * scale));
  var ox = Math.floor((dw - rw) / 2);
  var oy = Math.floor((dh - rh) / 2);
  var y;
  for (y = 0; y < rh; y++) {
    var sy = Math.min(sh - 1, (y * sh / rh) | 0);
    var x;
    for (x = 0; x < rw; x++) {
      var sx = Math.min(sw - 1, (x * sw / rw) | 0);
      var si = (sy * sw + sx) * 4;
      var di = ((oy + y) * dw + (ox + x)) * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  return dst;
}

function cropResizeRgba(src, sw, sh, dw, dh, cropFrac) {
  cropFrac = cropFrac || 0;
  var mx = Math.floor(sw * cropFrac);
  var my = Math.floor(sh * cropFrac);
  var cw = Math.max(1, sw - mx * 2);
  var ch = Math.max(1, sh - my * 2);
  var dst = new Uint8Array(dw * dh * 4);
  for (var y = 0; y < dh; y++) {
    var sy = my + Math.min(ch - 1, (y * ch / dh) | 0);
    for (var x = 0; x < dw; x++) {
      var sx = mx + Math.min(cw - 1, (x * cw / dw) | 0);
      var si = (sy * sw + sx) * 4;
      var di = (y * dw + x) * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  return dst;
}

function composite(bg, rain, len) {
  var out = new Uint8Array(len);
  for (var i = 0; i < len; i += 4) {
    var a = rain ? rain[i + 3] : 0;
    if (a > 24) {
      out[i] = rain[i];
      out[i + 1] = rain[i + 1];
      out[i + 2] = rain[i + 2];
      out[i + 3] = 255;
    } else if (bg) {
      out[i] = bg[i];
      out[i + 1] = bg[i + 1];
      out[i + 2] = bg[i + 2];
      out[i + 3] = 255;
    } else {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 255;
    }
  }
  return out;
}

function setPixel(rgba, w, h, x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  var i = (y * w + x) * 4;
  rgba[i] = r;
  rgba[i + 1] = g;
  rgba[i + 2] = b;
  rgba[i + 3] = 255;
}

function drawCrosshair(rgba, w, h, cx, cy) {
  cx = Math.round(cx);
  cy = Math.round(cy);
  if (cx < 2 || cy < 2 || cx > w - 3 || cy > h - 3) return;
  var arm = Math.max(7, Math.round(w * 0.07));
  var gap = 2;
  function stroke(color, thick) {
    var r = color[0];
    var g = color[1];
    var b = color[2];
    for (var t = -thick; t <= thick; t++) {
      for (var a = gap; a <= arm; a++) {
        setPixel(rgba, w, h, cx + a, cy + t, r, g, b);
        setPixel(rgba, w, h, cx - a, cy + t, r, g, b);
        setPixel(rgba, w, h, cx + t, cy + a, r, g, b);
        setPixel(rgba, w, h, cx + t, cy - a, r, g, b);
      }
    }
  }
  stroke([255, 255, 255], 2);
  stroke([255, 0, 0], 1);
}

function encodePalettedPng(width, height, rgba) {
  var pal = paletteRgb();
  var indices = new Uint8Array(width * height);
  for (var i = 0, p = 0; i < indices.length; i++, p += 4) {
    indices[i] = pebbleIndex(rgba[p], rgba[p + 1], rgba[p + 2]);
  }

  var raw = new Uint8Array((width + 1) * height);
  for (var y = 0; y < height; y++) {
    var row = y * (width + 1);
    raw[row] = 0;
    raw.set(indices.subarray(y * width, y * width + width), row + 1);
  }

  var compressed = pako.deflate(raw);
  if (!(compressed instanceof Uint8Array)) {
    compressed = new Uint8Array(compressed);
  }

  var ihdr = new Uint8Array([
    (width >> 24) & 255, (width >> 16) & 255, (width >> 8) & 255, width & 255,
    (height >> 24) & 255, (height >> 16) & 255, (height >> 8) & 255, height & 255,
    8, 3, 0, 0, 0
  ]);

  var sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return concat(
    sig,
    chunk('IHDR', ihdr),
    chunk('PLTE', pal),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0))
  );
}

function encodeBwPng(width, height, rgba) {
  var rowBytes = 1 + ((width + 7) >> 3);
  var raw = new Uint8Array(rowBytes * height);
  for (var y = 0; y < height; y++) {
    var row = y * rowBytes;
    raw[row] = 0;
    for (var x = 0; x < width; x++) {
      var p = (y * width + x) * 4;
      if ((rgba[p] + rgba[p + 1] + rgba[p + 2]) > 90) {
        raw[row + 1 + (x >> 3)] |= (0x80 >> (x & 7));
      }
    }
  }

  var compressed = pako.deflate(raw);
  if (!(compressed instanceof Uint8Array)) {
    compressed = new Uint8Array(compressed);
  }

  var ihdr = new Uint8Array([
    (width >> 24) & 255, (width >> 16) & 255, (width >> 8) & 255, width & 255,
    (height >> 24) & 255, (height >> 16) & 255, (height >> 8) & 255, height & 255,
    1, 0, 0, 0, 0
  ]);

  var sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return concat(
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0))
  );
}

function encodePng(width, height, rgba, bw) {
  return bw ? encodeBwPng(width, height, rgba) : encodePalettedPng(width, height, rgba);
}

module.exports = {
  resizeRgba: cropResizeRgba,
  cropResizeRgba: cropResizeRgba,
  extractRect: extractRect,
  fitContainRgba: fitContainRgba,
  composite: composite,
  drawCrosshair: drawCrosshair,
  encodePalettedPng: encodePalettedPng,
  encodeBwPng: encodeBwPng,
  encodePng: encodePng
};
