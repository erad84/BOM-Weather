var UPNG = require('./vendor/upng.js');
var pngutil = require('./pngutil');
var radars = require('./radars');

function pad(n, w) {
  var s = String(n);
  while (s.length < w) s = '0' + s;
  return s;
}

var cadenceCache = {};
var COMMON_INTERVALS = [6, 10, 5, 8, 15, 30, 4, 7, 12, 20, 3];
var LOOKBACK_MIN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 18, 20, 24, 30, 36, 40, 45];

function formatStampMs(ms) {
  var d = new Date(ms);
  return pad(d.getUTCFullYear(), 4) +
    pad(d.getUTCMonth() + 1, 2) +
    pad(d.getUTCDate(), 2) +
    pad(d.getUTCHours(), 2) +
    pad(d.getUTCMinutes(), 2);
}

function floorMinuteMs() {
  return Math.floor(Date.now() / 60000) * 60000;
}

function latestExpectedMs(intervalMin, offsetMin) {
  var interval = (intervalMin || 6) * 60000;
  var offset = (offsetMin || 0) * 60000;
  var t = Math.floor((Date.now() - offset) / interval) * interval + offset;
  if (Date.now() - t < 20000) t -= interval;
  return t;
}

function offsetFromMs(ms, intervalMin) {
  var d = new Date(ms);
  return (d.getUTCHours() * 60 + d.getUTCMinutes()) % intervalMin;
}

function rainPath(productId, stamp) {
  return 'radar/' + productId + '.T.' + stamp + '.png';
}

function stampsFromCadence(cadence, count) {
  var out = [];
  var interval = cadence.intervalMin * 60000;
  var i;
  for (i = count - 1; i >= 0; i--) {
    out.push(formatStampMs(cadence.latestMs - i * interval));
  }
  return out;
}

function bytesFromRequest(req, useBuffer) {
  if (useBuffer && req.response) {
    return new Uint8Array(req.response);
  }
  var text = req.responseText || '';
  var bytes = new Uint8Array(text.length);
  for (var i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function xhrBytes(url, cb) {
  var req = new XMLHttpRequest();
  var done = false;
  var useBuffer = false;
  function finish(err, bytes) {
    if (done) return;
    done = true;
    cb(err, bytes);
  }
  function handle() {
    if (typeof req.readyState !== 'undefined' && req.readyState !== 4) return;
    var bytes = bytesFromRequest(req, useBuffer);
    var ok = (req.status >= 200 && req.status < 300) ||
      (req.status === 0 && bytes && bytes.length > 50);
    if (ok) finish(null, bytes);
    else finish(new Error('HTTP ' + req.status));
  }
  req.open('GET', url, true);
  try {
    req.responseType = 'arraybuffer';
    useBuffer = true;
  } catch (e) {
    if (req.overrideMimeType) {
      req.overrideMimeType('text/plain; charset=x-user-defined');
    }
  }
  req.onreadystatechange = handle;
  req.onload = handle;
  req.onerror = function () {
    finish(new Error('network'));
  };
  try {
    req.timeout = 15000;
  } catch (e) {}
  req.send();
}

function xhrBytesFallback(path, cb) {
  var urls = [
    'https://reg.bom.gov.au/' + path,
    'http://reg.bom.gov.au/' + path
  ];
  var i = 0;
  function next() {
    if (i >= urls.length) {
      cb(new Error('network'));
      return;
    }
    xhrBytes(urls[i++], function (err, bytes) {
      if (err) next();
      else cb(null, bytes);
    });
  }
  next();
}

function xhrExists(url, cb) {
  var req = new XMLHttpRequest();
  var done = false;
  function finish(ok, networkErr) {
    if (done) return;
    done = true;
    cb(!!ok, !!networkErr);
  }
  req.open('GET', url, true);
  req.onreadystatechange = function () {
    if (typeof req.readyState !== 'undefined' && req.readyState !== 4) return;
    var s = req.status;
    if (s >= 200 && s < 300) finish(true, false);
    else if (s) finish(false, false);
  };
  req.onload = function () {
    var s = req.status;
    finish((s >= 200 && s < 300) || s === 0, false);
  };
  req.onerror = function () {
    finish(false, true);
  };
  try { req.timeout = 8000; } catch (e) {}
  req.ontimeout = function () {
    finish(false, true);
  };
  req.send();
}

function rainExists(productId, stamp, cb) {
  var path = rainPath(productId, stamp);
  xhrExists('https://reg.bom.gov.au/' + path, function (ok, networkErr) {
    if (ok) {
      cb(true);
      return;
    }
    if (!networkErr) {
      cb(false);
      return;
    }
    xhrExists('http://reg.bom.gov.au/' + path, function (ok2) {
      cb(!!ok2);
    });
  });
}

function makeCadence(latestMs, intervalMin) {
  return {
    latestMs: latestMs,
    intervalMin: intervalMin,
    offsetMin: offsetFromMs(latestMs, intervalMin),
    at: Date.now()
  };
}

function detectInterval(productId, latestMs, hintInterval, cb) {
  var intervals = [];
  var seen = {};
  function add(n) {
    if (n && n > 0 && n <= 40 && !seen[n]) {
      seen[n] = 1;
      intervals.push(n);
    }
  }
  add(hintInterval);
  var i;
  for (i = 0; i < COMMON_INTERVALS.length; i++) add(COMMON_INTERVALS[i]);

  var hits = [];
  var pending = intervals.length;
  if (!pending) {
    cb(hintInterval || 10);
    return;
  }
  function consider() {
    if (pending > 0) return;
    hits.sort(function (a, b) { return a - b; });
    if (!hits.length) {
      cb(hintInterval || 10);
      return;
    }
    var interval = hits[0];
    var verify = formatStampMs(latestMs - 2 * interval * 60000);
    rainExists(productId, verify, function (ok) {
      if (ok || hits.length === 1) {
        cb(interval);
        return;
      }
      cb(hits[1] || interval);
    });
  }
  for (i = 0; i < intervals.length; i++) {
    (function (iv) {
      rainExists(productId, formatStampMs(latestMs - iv * 60000), function (ok) {
        if (ok) hits.push(iv);
        pending--;
        consider();
      });
    })(intervals[i]);
  }
}

function findLatestStamp(productId, cb) {
  var now = floorMinuteMs();
  var idx = 0;
  function step() {
    if (idx >= LOOKBACK_MIN.length) {
      cb(null);
      return;
    }
    var end = Math.min(LOOKBACK_MIN.length, idx + 4);
    var batch = LOOKBACK_MIN.slice(idx, end);
    idx = end;
    var pending = batch.length;
    var bestAgo = null;
    var i;
    for (i = 0; i < batch.length; i++) {
      (function (ago) {
        rainExists(productId, formatStampMs(now - ago * 60000), function (ok) {
          if (ok && (bestAgo == null || ago < bestAgo)) bestAgo = ago;
          pending--;
          if (pending > 0) return;
          if (bestAgo != null) cb(now - bestAgo * 60000);
          else step();
        });
      })(batch[i]);
    }
  }
  step();
}

function refreshCachedCadence(productId, cached, cb) {
  var latest = latestExpectedMs(cached.intervalMin, cached.offsetMin);
  rainExists(productId, formatStampMs(latest), function (ok) {
    if (ok) {
      cached.latestMs = latest;
      cached.at = Date.now();
      cb(null, cached);
      return;
    }
    var prev = latest - cached.intervalMin * 60000;
    rainExists(productId, formatStampMs(prev), function (ok2) {
      if (ok2) {
        cached.latestMs = prev;
        cached.at = Date.now();
        cb(null, cached);
        return;
      }
      delete cadenceCache[productId];
      detectCadence(productId, null, cb);
    });
  });
}

function tryHintCadence(productId, opts, cb) {
  var intervalMin = opts && opts.intervalMin;
  if (!intervalMin) {
    cb(null);
    return;
  }
  var latest = latestExpectedMs(intervalMin, opts.offsetMin || 0);
  rainExists(productId, formatStampMs(latest), function (ok) {
    function confirm(fromMs) {
      rainExists(productId, formatStampMs(fromMs - intervalMin * 60000), function (ok2) {
        cb(ok2 ? makeCadence(fromMs, intervalMin) : null);
      });
    }
    if (ok) {
      confirm(latest);
      return;
    }
    var prev = latest - intervalMin * 60000;
    rainExists(productId, formatStampMs(prev), function (ok2) {
      if (ok2) confirm(prev);
      else cb(null);
    });
  });
}

function detectCadence(productId, opts, cb) {
  opts = opts || {};
  var cached = cadenceCache[productId];
  if (cached && Date.now() - cached.at < 8 * 60 * 1000) {
    refreshCachedCadence(productId, cached, cb);
    return;
  }
  tryHintCadence(productId, opts, function (hinted) {
    if (hinted) {
      cadenceCache[productId] = hinted;
      cb(null, hinted);
      return;
    }
    findLatestStamp(productId, function (latestMs) {
      if (!latestMs) {
        cb(new Error('no frames'));
        return;
      }
      detectInterval(productId, latestMs, opts.intervalMin, function (intervalMin) {
        var rec = makeCadence(latestMs, intervalMin);
        cadenceCache[productId] = rec;
        cb(null, rec);
      });
    });
  });
}

function decodeRgba(bytes) {
  var img = UPNG.decode(bytes);
  var frames = UPNG.toRGBA8(img);
  return {
    w: img.width,
    h: img.height,
    rgba: new Uint8Array(frames[0])
  };
}

function fetchOne(path, cb) {
  xhrBytesFallback(path, function (err, bytes) {
    if (err) return cb(err);
    try {
      cb(null, decodeRgba(bytes));
    } catch (e) {
      cb(e);
    }
  });
}

function mosaicPx(opts, sw, sh, lat, lon) {
  var rangeKm = opts.rangeKm || 128;
  var kmN = (lat - opts.radarLat) * 111.32;
  var kmE = (lon - opts.radarLon) * 111.32 *
    Math.cos(opts.radarLat * Math.PI / 180);
  var radiusFrac = opts.radiusFrac != null ? opts.radiusFrac : 0.47;
  var radiusPx = Math.min(sw, sh) * radiusFrac;
  var pxPerKm = radiusPx / rangeKm;
  return {
    x: sw / 2 + kmE * pxPerKm,
    y: sh / 2 - kmN * pxPerKm
  };
}

function hasCoords(lat, lon) {
  return typeof lat === 'number' && typeof lon === 'number' &&
    isFinite(lat) && isFinite(lon) && !(lat === 0 && lon === 0);
}

function townToPixel(opts, sw, sh, dw, dh, crop) {
  var p = mosaicPx(opts, sw, sh, opts.townLat, opts.townLon);
  var mx;
  var my;
  var cw;
  var ch;
  if (crop && crop.w) {
    mx = crop.x;
    my = crop.y;
    cw = crop.w;
    ch = crop.h;
  } else {
    var cropFrac = (typeof crop === 'number') ? crop : 0;
    mx = Math.floor(sw * cropFrac);
    my = Math.floor(sh * cropFrac);
    cw = Math.max(1, sw - mx * 2);
    ch = Math.max(1, sh - my * 2);
  }
  var x = (p.x - mx) / cw * dw;
  var y = (p.y - my) / ch * dh;
  if (x < 4 || y < 4 || x > dw - 5 || y > dh - 5) return null;
  return { x: x, y: y };
}

function boundsBox(opts, sw, sh, b) {
  var pts = [
    mosaicPx(opts, sw, sh, b.south, b.west),
    mosaicPx(opts, sw, sh, b.south, b.east),
    mosaicPx(opts, sw, sh, b.north, b.west),
    mosaicPx(opts, sw, sh, b.north, b.east)
  ];
  var minX = Math.min(pts[0].x, pts[1].x, pts[2].x, pts[3].x);
  var maxX = Math.max(pts[0].x, pts[1].x, pts[2].x, pts[3].x);
  var minY = Math.min(pts[0].y, pts[1].y, pts[2].y, pts[3].y);
  var maxY = Math.max(pts[0].y, pts[1].y, pts[2].y, pts[3].y);
  var pad = Math.max(maxX - minX, maxY - minY) * 0.08;
  minX -= pad;
  maxX += pad;
  minY -= pad;
  maxY += pad;
  var cx = (minX + maxX) / 2;
  var cy = (minY + maxY) / 2;
  var side = Math.max(maxX - minX, maxY - minY, 8);
  if (side > sw) side = sw;
  if (side > sh) side = sh;
  var x0 = Math.round(cx - side / 2);
  var y0 = Math.round(cy - side / 2);
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x0 + side > sw) x0 = sw - side;
  if (y0 + side > sh) y0 = sh - side;
  return { x: x0, y: y0, w: Math.round(side), h: Math.round(side) };
}

function zoomBox(opts, sw, sh) {
  if (opts.zoomBounds) {
    return boundsBox(opts, sw, sh, opts.zoomBounds);
  }
  var rangeKm = opts.rangeKm || 2150;
  var radiusFrac = opts.radiusFrac != null ? opts.radiusFrac : 0.5;
  var radiusPx = Math.min(sw, sh) * radiusFrac;
  var pxPerKm = radiusPx / rangeKm;
  var zoomKm = opts.zoomKm || 1100;
  var size = Math.max(8, Math.round(zoomKm * 2 * pxPerKm));
  var cx = sw / 2;
  var cy = sh / 2;
  if (hasCoords(opts.townLat, opts.townLon) && hasCoords(opts.radarLat, opts.radarLon)) {
    var p = mosaicPx(opts, sw, sh, opts.townLat, opts.townLon);
    cx = p.x;
    cy = p.y;
  }
  if (size > sw) size = sw;
  if (size > sh) size = sh;
  var x0 = Math.round(cx - size / 2);
  var y0 = Math.round(cy - size / 2);
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x0 + size > sw) x0 = sw - size;
  if (y0 + size > sh) y0 = sh - size;
  return { x: x0, y: y0, w: size, h: size };
}

function fetchFramesFor(productId, size, opts, cb) {
  opts = opts || {};
  var overlayNames = ['topography', 'catchments', 'waterways', 'roads', 'rail', 'range', 'locations'];
  var wanted = [];
  var ov = opts.overlays || { locations: true };
  for (var o = 0; o < overlayNames.length; o++) {
    var key = overlayNames[o];
    if (ov[key]) wanted.push(key);
  }

  var want = opts.bw ? 4 : 5;
  var cropFrac = opts.cropFrac != null ? opts.cropFrac : 0.16;
  var layerId = opts.overlayProductId || productId;
  var cadenceInfo = null;
  var cadenceErr = null;
  var cadenceDone = false;
  var overlaysDone = false;
  var overlayBg = null;
  var overlayImgs = [];

  function maybeStart() {
    if (!cadenceDone || !overlaysDone) return;
    if (cadenceErr || !cadenceInfo) {
      cb(cadenceErr || new Error('no frames'));
      return;
    }
    startRain(overlayBg, overlayImgs, cadenceInfo);
  }

  function afterBackground(bg) {
    var layers = [];
    var li = 0;

    function loadOverlay() {
      if (li >= wanted.length) {
        overlayBg = bg;
        overlayImgs = layers;
        overlaysDone = true;
        maybeStart();
        return;
      }
      var name = wanted[li++];
      fetchOne('products/radar_transparencies/' + layerId + '.' + name + '.png', function (err, img) {
        if (img) layers.push(img);
        loadOverlay();
      });
    }

    loadOverlay();
  }

  function startRain(backgroundImg, overlayList, cadence) {
      var times = stampsFromCadence(cadence, want + 2);
      var background = null;
      var bw = 512;
      var bh = 512;
      if (backgroundImg) {
        background = backgroundImg.rgba;
        bw = backgroundImg.w;
        bh = backgroundImg.h;
        for (var i = 0; i < overlayList.length; i++) {
          var ovl = overlayList[i];
          if (ovl && ovl.w === bw && ovl.h === bh) {
            background = pngutil.composite(background, ovl.rgba, background.length);
          }
        }
      }

      var frames = [];
      var ti = times.length - 1;

      function next() {
        if (frames.length >= want || ti < 0) {
          if (!frames.length) {
            delete cadenceCache[productId];
            return cb(new Error('no frames'));
          }
          cb(null, frames);
          return;
        }
        var framePath = rainPath(productId, times[ti]);
        ti--;
        fetchOne(framePath, function (err, rain) {
          if (err || !rain) {
            next();
            return;
          }
          var w = rain.w;
          var h = rain.h;
          var bgUse = background;
          if (bgUse && (bw !== w || bh !== h)) bgUse = null;
          var composed = pngutil.composite(bgUse, rain.rgba, rain.rgba.length);
          var dw = Math.max(120, Math.min(size, 200));
          var cropRect = (opts.zoomBounds || opts.zoomKm) ? zoomBox(opts, w, h) : null;
          var resized = cropRect
            ? pngutil.cropRectResizeRgba(composed, w, h, cropRect.x, cropRect.y, cropRect.w, cropRect.h, dw, dw)
            : pngutil.cropResizeRgba(composed, w, h, dw, dw, cropFrac);
          if (!opts.skipCrosshair && opts && hasCoords(opts.townLat, opts.townLon) && hasCoords(opts.radarLat, opts.radarLon)) {
            var mark = townToPixel(opts, w, h, dw, dw, cropRect || cropFrac);
            if (mark) pngutil.drawCrosshair(resized, dw, dw, mark.x, mark.y);
          }
          var png = pngutil.encodePng(dw, dw, resized, opts.bw);
          frames.unshift(png);
          next();
        });
      }

      next();
  }

  detectCadence(productId, opts, function (err, c) {
    cadenceErr = err;
    cadenceInfo = c;
    cadenceDone = true;
    maybeStart();
  });

  if (opts.skipBackground) {
    afterBackground(null);
    return;
  }

  fetchOne('products/radar_transparencies/' + layerId + '.background.png', function (bgErr, bg) {
    afterBackground(bg);
  });
}

function haversine(lat1, lon1, lat2, lon2) {
  var r = 6371;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function copyOpts(opts, extra) {
  var out = {
    townLat: opts.townLat,
    townLon: opts.townLon,
    radarLat: opts.radarLat,
    radarLon: opts.radarLon,
    rangeKm: opts.rangeKm,
    radiusFrac: opts.radiusFrac,
    overlays: opts.overlays,
    overlayProductId: opts.overlayProductId,
    skipBackground: opts.skipBackground,
    skipCrosshair: opts.skipCrosshair,
    cropFrac: opts.cropFrac,
    zoomKm: opts.zoomKm,
    zoomBounds: opts.zoomBounds,
    intervalMin: opts.intervalMin,
    offsetMin: opts.offsetMin,
    bw: opts.bw
  };
  if (extra) {
    for (var k in extra) {
      if (extra.hasOwnProperty(k)) out[k] = extra[k];
    }
  }
  return out;
}

function nearbyRangeProducts(productId, lat, lon) {
  if (!productId || productId.length < 2) return [];
  var digit = productId.charAt(productId.length - 1);
  var scored = [];
  for (var i = 0; i < radars.length; i++) {
    var r = radars[i];
    if (!r || !r.id) continue;
    var pid = r.id.slice(0, -1) + digit;
    if (pid === productId) continue;
    var d = 1e9;
    if (typeof lat === 'number' && typeof lon === 'number') {
      d = haversine(lat, lon, r.lat, r.lon);
    }
    scored.push({ pid: pid, d: d, lat: r.lat, lon: r.lon, n: r.n });
  }
  scored.sort(function (a, b) { return a.d - b.d; });
  return scored.slice(0, 3);
}

function fetchFrames(productId, size, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }
  opts = opts || {};

  function try128(err) {
    if (opts.skipFallback) {
      cb(err || new Error('no frames'), null, productId);
      return;
    }
    var fallback = productId ? productId.slice(0, -1) + '3' : productId;
    if (!fallback || fallback === productId) {
      cb(err || new Error('no frames'), null, productId);
      return;
    }
    fetchFramesFor(fallback, size, copyOpts(opts, { rangeKm: 128 }), function (e2, pngs2) {
      cb(e2, pngs2, fallback);
    });
  }

  fetchFramesFor(productId, size, opts, function (err, pngs) {
    if (!err && pngs && pngs.length) {
      cb(null, pngs, productId);
      return;
    }
    if (opts.zoomKm || opts.zoomBounds || productId === 'IDR00004') {
      cb(err || new Error('no frames'), null, productId);
      return;
    }
    var alts = nearbyRangeProducts(productId, opts.townLat || opts.radarLat, opts.townLon || opts.radarLon);
    function tryAlt(i) {
      if (i >= alts.length) {
        try128(err);
        return;
      }
      var alt = alts[i];
      fetchFramesFor(alt.pid, size, copyOpts(opts, { radarLat: alt.lat, radarLon: alt.lon }), function (e2, pngs2) {
        if (!e2 && pngs2 && pngs2.length) {
          cb(null, pngs2, alt.pid);
          return;
        }
        tryAlt(i + 1);
      });
    }
    tryAlt(0);
  });
}

function fetchNotice(productId, siteName, cb) {
  var urls = [
    'https://reg.bom.gov.au/radar/' + productId + '.txt',
    'http://reg.bom.gov.au/radar/' + productId + '.txt'
  ];
  var i = 0;
  function next() {
    if (i >= urls.length) {
        cb(null, (siteName || 'This radar') + ' is not publishing this range. BOM may not offer it here, or the site may be down for maintenance.');
      return;
    }
    var req = new XMLHttpRequest();
    var url = urls[i++];
    var done = false;
    function finish(text) {
      if (done) return;
      done = true;
      if (text && text.length > 20 && text.length < 1500 && text.indexOf('<html') < 0 && text.indexOf('<HTML') < 0) {
        cb(null, text.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''));
      } else {
        next();
      }
    }
    req.open('GET', url, true);
    req.onload = function () {
      finish(req.responseText || '');
    };
    req.onerror = function () { finish(''); };
    try { req.timeout = 8000; } catch (e) {}
    req.send();
  }
  next();
}

function toByteArray(u8) {
  var arr = [];
  for (var i = 0; i < u8.length; i++) arr.push(u8[i]);
  return arr;
}

function sendPngs(pngs, sendFn, done, isCurrent) {
  var frame = 0;
  var chunkSize = 800;

  function alive() {
    return !isCurrent || isCurrent();
  }

  function sendFrame() {
    if (!alive()) {
      done(new Error('abort'));
      return;
    }
    if (frame >= pngs.length) {
      done(null);
      return;
    }
    var png = pngs[frame];
    var offset = 0;

    function sendHeader() {
      if (!alive()) {
        done(new Error('abort'));
        return;
      }
      sendFn({
        RadarFrameCount: pngs.length,
        RadarFrameIndex: frame,
        RadarTotalSize: png.length
      }, function () {
        sendChunk();
      }, function () {
        done(new Error('header'));
      });
    }

    function sendChunk() {
      if (!alive()) {
        done(new Error('abort'));
        return;
      }
      if (offset >= png.length) {
        sendFn({
          RadarComplete: 1,
          RadarFrameIndex: frame
        }, function () {
          frame++;
          sendFrame();
        }, function () {
          done(new Error('complete'));
        });
        return;
      }
      var end = Math.min(png.length, offset + chunkSize);
      var slice = png.subarray(offset, end);
      var payload = {
        RadarChunk: toByteArray(slice),
        RadarOffset: offset,
        RadarFrameIndex: frame
      };
      var thisOffset = offset;
      offset = end;
      sendFn(payload, sendChunk, function () {
        offset = thisOffset;
        sendChunk();
      });
    }

    sendHeader();
  }

  sendFrame();
}

function xhrBytesHosts(path, cb) {
  var urls = [
    'https://www.bom.gov.au/' + path,
    'https://reg.bom.gov.au/' + path,
    'http://www.bom.gov.au/' + path,
    'http://reg.bom.gov.au/' + path
  ];
  var i = 0;
  function next() {
    if (i >= urls.length) {
      cb(new Error('network'));
      return;
    }
    xhrBytes(urls[i++], function (err, bytes) {
      if (err) next();
      else cb(null, bytes);
    });
  }
  next();
}

function axisMeans(rgba, w, h, alongRow) {
  var n = alongRow ? h : w;
  var avgs = new Float32Array(n);
  var i;
  if (alongRow) {
    for (i = 0; i < h; i++) {
      var s = 0;
      var x;
      for (x = 0; x < w; x += 2) {
        var p = (i * w + x) * 4;
        s += (rgba[p] + rgba[p + 1] + rgba[p + 2]) / 3;
      }
      avgs[i] = s / (w / 2);
    }
  } else {
    for (i = 0; i < w; i++) {
      var s2 = 0;
      var y;
      for (y = 0; y < h; y += 2) {
        var p2 = (y * w + i) * 4;
        s2 += (rgba[p2] + rgba[p2 + 1] + rgba[p2 + 2]) / 3;
      }
      avgs[i] = s2 / (h / 2);
    }
  }
  return avgs;
}

function contentSpans(avgs, minLen, whiteThresh) {
  var spans = [];
  var i = 0;
  while (i < avgs.length) {
    while (i < avgs.length && avgs[i] >= whiteThresh) i++;
    var start = i;
    while (i < avgs.length && avgs[i] < whiteThresh) i++;
    if (i - start >= minLen) spans.push([start, i]);
  }
  return spans;
}

function synopticCells(rgba, w, h) {
  var rows = contentSpans(axisMeans(rgba, w, h, true), 80, 248);
  var cols = contentSpans(axisMeans(rgba, w, h, false), 80, 248);
  if (rows.length < 4) {
    rows = [[64, 297], [299, 533], [535, 768], [770, 1003]];
  }
  if (cols.length < 2) {
    cols = [[8, 298], [306, 596]];
  }
  if (rows.length > 4) rows = rows.slice(rows.length - 4);
  if (cols.length > 2) cols = cols.slice(0, 2);
  var cells = [];
  var r;
  var c;
  for (r = 0; r < rows.length; r++) {
    for (c = 0; c < cols.length; c++) {
      cells.push({
        x: cols[c][0],
        y: rows[r][0],
        w: cols[c][1] - cols[c][0],
        h: rows[r][1] - rows[r][0]
      });
    }
  }
  return cells;
}

function fetchSynoptic(size, cb, bw) {
  var omggif = require('./vendor/omggif');
  xhrBytesHosts('fwo/IDG00074.gif', function (err, bytes) {
    if (err || !bytes) {
      cb(err || new Error('no chart'));
      return;
    }
    try {
      var reader = new omggif.GifReader(bytes);
      var w = reader.width;
      var h = reader.height;
      var rgba = new Uint8Array(w * h * 4);
      reader.decodeAndBlitFrameRGBA(0, rgba);
      var cells = synopticCells(rgba, w, h);
      if (!cells.length) {
        cb(new Error('bad chart'));
        return;
      }
      var dw = Math.max(120, Math.min(size, 200));
      var pngs = [];
      var i;
      for (i = 0; i < cells.length; i++) {
        var cell = cells[i];
        var cut = pngutil.extractRect(rgba, w, h, cell.x, cell.y, cell.w, cell.h);
        var fitted = pngutil.fitContainRgba(cut.rgba, cut.w, cut.h, dw, dw);
        pngs.push(pngutil.encodePng(dw, dw, fitted, bw));
      }
      cb(null, pngs);
    } catch (e) {
      cb(e);
    }
  });
}

module.exports = {
  fetchFrames: fetchFrames,
  sendPngs: sendPngs,
  fetchNotice: fetchNotice,
  fetchSynoptic: fetchSynoptic
};
