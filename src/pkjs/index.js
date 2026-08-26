var bom = require('./bom');
var radar = require('./radar');
var config = require('./config');
var postcodes = require('./postcodes');

var lastForecast = null;
var sendingRadar = false;
var radarGen = 0;
var sendQueue = [];
var sending = false;

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('bomSettings') || '{}');
  } catch (e) {
    return {};
  }
}

function saveSettings(settings) {
  localStorage.setItem('bomSettings', JSON.stringify(settings || {}));
}

function loadLastLoc() {
  try {
    return JSON.parse(localStorage.getItem('bomLastLoc') || 'null');
  } catch (e) {
    return null;
  }
}

function coastalOn() {
  var s = loadSettings();
  return s.CoastalDetails === true || s.CoastalDetails === 1 || s.CoastalDetails === '1';
}

function payloadInt(p, name) {
  if (!p) return 0;
  var v = p[name];
  if (v == null) {
    if (name === 'RequestType') v = p['1'] != null ? p['1'] : p[1];
    else if (name === 'DetailIndex') v = p['6'] != null ? p['6'] : p[6];
  }
  if (v && typeof v === 'object' && v.length) v = v[0];
  var n = parseInt(v, 10);
  return isFinite(n) ? n : 0;
}

function themeLight() {
  var s = loadSettings();
  return s.Theme === 'light' || s.Theme === 1 || s.Theme === '1';
}

function clip(s, n) {
  s = s || '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1);
}

function isAplite() {
  return watchPlatform() === 'aplite';
}

function isBwWatch() {
  var p = watchPlatform();
  return p === 'aplite' || p === 'diorite' || p === 'flint';
}

function hasRadar() {
  return !isAplite();
}

function sendForecast(result, success, fail) {
  var dict = forecastDict(result);
  var packed = dict.WarnPacked;
  if (packed) {
    delete dict.WarnPacked;
    send(dict, function () {
      send({ WarnPacked: packed }, success, fail);
    }, fail);
    return;
  }
  send(dict, success, fail);
}

function pumpSend() {
  if (sending || !sendQueue.length) return;
  sending = true;
  var item = sendQueue.shift();
  Pebble.sendAppMessage(item.dict, function () {
    sending = false;
    if (item.success) item.success();
    pumpSend();
  }, function (e) {
    sending = false;
    console.log('send failed ' + JSON.stringify(e));
    if (item.fail) item.fail(e);
    pumpSend();
  });
}

function send(dict, success, fail) {
  sendQueue.push({ dict: dict, success: success, fail: fail });
  pumpSend();
}

function sendStatus(code, location) {
  send({
    Status: code,
    Location: clip(location || '', 31)
  });
}

function packDays(days) {
  var lines = [];
  for (var i = 0; i < days.length && i < 7; i++) {
    var d = days[i];
    lines.push([
      clip(d.name, 21),
      isFinite(d.min) ? d.min : 99,
      isFinite(d.max) ? d.max : 99,
      clip((d.precis || '').replace(/\t|\n/g, ' '), 41),
      isFinite(d.rainChance) ? d.rainChance : -1,
      clip((d.rainAmount || '').replace(/\t|\n/g, ' '), 21),
      isFinite(d.icon) ? d.icon : 0,
      clip(d.title || d.name, 27),
      clip((d.uv || '').replace(/\t|\n/g, ' '), 15),
      clip((d.fdr || '').replace(/\t|\n/g, ' '), 15)
    ].join('\t'));
  }
  return lines.join('\n');
}

function packWarningBodies(warnings, titleMax, bodyMax, packedMax, maxCount) {
  var n = Math.min(warnings.length, maxCount);
  var titles = [];
  var bodies = [];
  var i;
  for (i = 0; i < n; i++) {
    titles.push(clip(bom.cleanWarnTitle(warnings[i].title), titleMax));
    bodies.push(bodyMax > 0 ? clip(bom.pebbleSafe(warnings[i].body || warnings[i].desc || ''), bodyMax) : '');
  }
  function build() {
    var lines = [];
    for (i = 0; i < n; i++) {
      lines.push([warnings[i].type || 'other', titles[i], bodies[i]].join('\t'));
    }
    return lines.join('\n');
  }
  var packed = build();
  while (packed.length > packedMax) {
    var longest = 0;
    for (i = 1; i < n; i++) {
      if (bodies[i].length > bodies[longest].length) longest = i;
    }
    if (bodies[longest].length <= 80) break;
    bodies[longest] = clip(bodies[longest], Math.max(80, bodies[longest].length - 80));
    packed = build();
  }
  return packed;
}

function forecastDict(result) {
  var aplite = isAplite();
  var dict = {
    Status: 0,
    Location: clip(result.location + (result.state ? ', ' + result.state : ''), 31),
    DayCount: result.days.length,
    DaysPacked: packDays(result.days)
  };
  if (result.obs) {
    dict.CondLine1 = result.obs.temp != null ? String(result.obs.temp) : '';
    dict.CondLine2 = [
      result.obs.hum != null ? String(result.obs.hum) : '',
      result.obs.deltaT != null ? String(result.obs.deltaT) : '',
      clip(result.obs.wind || '', 31),
      result.obs.apparent != null ? String(result.obs.apparent) : '',
      result.obs.msl != null ? String(result.obs.msl) : '',
      clip(result.obs.windDir || '', 7),
      result.obs.windKmh != null ? String(result.obs.windKmh) : '',
      result.obs.gust != null ? String(result.obs.gust) : '',
      result.obs.dew != null ? String(result.obs.dew) : '',
      clip(result.obs.rain || '', 11)
    ].join('\t');
  }
  if (result.warnings && result.warnings.length) {
    var titleMax = aplite ? 119 : 159;
    var packedMax = aplite ? 500 : 1000;
    var packed = packWarningBodies(result.warnings, titleMax, 0, packedMax, aplite ? 3 : 5);
    dict.WarnPacked = packed;
    dict.WarnTitle = result.warnings.length === 1
      ? clip(bom.cleanWarnTitle(result.warnings[0].title), titleMax)
      : 'Warnings';
    dict.WarnSub = clip(result.warnings.length === 1
      ? 'Select warning'
      : (result.warnings.length + ' warnings'), 47);
  } else if (result.warning && result.warning.title) {
    dict.WarnTitle = clip(bom.cleanWarnTitle(result.warning.title), aplite ? 119 : 159);
    dict.WarnSub = clip(bom.pebbleSafe(result.warning.sub || ''), 47);
    dict.WarnPacked = [
      'other',
      dict.WarnTitle,
      ''
    ].join('\t');
  }
  if (result.fdr) dict.FdrNow = clip(String(result.fdr), 15);
  if (result.sunrise || result.sunset) {
    dict.SunTimes = clip((result.sunrise || '--') + '\t' + (result.sunset || '--'), 15);
  }
  if (result.cached) dict.Cached = 1;
  dict.HasCoastal = coastalOn() ? 1 : 0;
  dict.Theme = themeLight() ? 1 : 0;
  if (coastalOn() && result.days[0] && result.days[0].coastal) {
    dict.CoastalNow = clip(result.days[0].coastal.replace(/\t/g, ' '), aplite ? 239 : 299);
  }
  return dict;
}

function resolveLocation(cb) {
  var settings = loadSettings();
  if (settings.LocationMode === 'manual' && settings.TownName) {
    bom.resolveQuery(settings.TownName, function (err, loc) {
      if (err || !loc) return cb(new Error('notfound'));
      cb(null, loc);
    });
    return;
  }

  var gpsTimeout = setTimeout(function () {
    gpsTimeout = null;
    fallbackManual(cb, new Error('gps timeout'));
  }, 16000);

  navigator.geolocation.getCurrentPosition(function (pos) {
    if (!gpsTimeout) return;
    clearTimeout(gpsTimeout);
    cb(null, bom.nearestTown(pos.coords.latitude, pos.coords.longitude));
  }, function (err) {
    if (!gpsTimeout) return;
    clearTimeout(gpsTimeout);
    fallbackManual(cb, err);
  }, { timeout: 15000, maximumAge: 600000, enableHighAccuracy: false });
}

function fallbackManual(cb, err) {
  var settings = loadSettings();
  if (settings.TownName) {
    bom.resolveQuery(settings.TownName, function (qErr, loc) {
      if (!qErr && loc) return cb(null, loc);
      var last = loadLastLoc();
      if (last && last.aac) return cb(null, last);
      cb(err || new Error('location'));
    });
    return;
  }
  var last = loadLastLoc();
  if (last && last.aac) return cb(null, last);
  cb(err || new Error('location'));
}

function saveForecastCache(result) {
  try {
    localStorage.setItem('bomForecastCache', JSON.stringify({
      at: Date.now(),
      result: result
    }));
  } catch (e) {}
}

function loadForecastCache() {
  try {
    var raw = localStorage.getItem('bomForecastCache');
    if (!raw) return null;
    var o = JSON.parse(raw);
    if (!o || !o.result || !o.result.days || !o.result.days.length) return null;
    if (Date.now() - o.at > 36 * 3600 * 1000) return null;
    return o.result;
  } catch (e) {
    return null;
  }
}

function sendCachedForecast(locName) {
  var cached = loadForecastCache();
  if (!cached) return false;
  cached.cached = true;
  lastForecast = cached;
  sendForecast(cached);
  return true;
}

function fetchForecast() {
  sendStatus(1, 'Loading...');
  resolveLocation(function (err, loc) {
    if (err || !loc) {
      var code = (err && err.message === 'notfound') ? 4 : 2;
      if (!sendCachedForecast()) {
        sendStatus(code, code === 4 ? 'Town not found' : 'Set town in settings');
      }
      return;
    }
    localStorage.setItem('bomLastLoc', JSON.stringify(loc));
    sendStatus(1, loc.n);
    bom.fetchForecast(loc, {
      coastal: coastalOn(),
      skipWarningPages: isAplite()
    }, function (fetchErr, result) {
      if (fetchErr) {
        console.log('forecast err ' + fetchErr.message);
        if (!sendCachedForecast(loc.n)) {
          sendStatus(3, loc.n);
        }
        return;
      }
      lastForecast = result;
      saveForecastCache(result);
      sendForecast(result, function () {}, function () {
        sendStatus(3, loc.n);
      });
    });
  });
}

function stripWarnHeading(body, title) {
  body = bom.pebbleSafe(body || '').replace(/^\s+/, '');
  title = bom.cleanWarnTitle(title || '');
  if (title) {
    var prefix = body.slice(0, title.length);
    if (prefix.toLowerCase() === title.toLowerCase()) {
      body = body.slice(title.length).replace(/^[\s:,-]+/, '');
    }
  }
  return body.replace(/^\s+/, '');
}

function sendWarnBody(index) {
  var warnings = (lastForecast && lastForecast.warnings) || [];
  var i = parseInt(index, 10);
  if (!isFinite(i) || i < 0) i = 0;
  var w = warnings[i];
  var max = isAplite() ? 1399 : 3400;
  function done(text) {
    var body = stripWarnHeading(text, w && w.title);
    if (!body) body = 'No details.';
    send({
      DetailIndex: i,
      WarnBody: clip(body, max)
    });
  }
  var have = w ? (w.body || w.desc || '') : '';
  if (w && w.link && (!have || have.length < 200)) {
    bom.fetchWarningPage(w.link, function (err, text) {
      done(text || have);
    });
    return;
  }
  done(have);
}

function sendDetail(index) {
  if (!lastForecast || !lastForecast.days[index]) {
    send({ Status: 3, DetailIndex: index, DayExtended: 'No details.' });
    return;
  }
  var d = lastForecast.days[index];
  var aplite = isAplite();
  var extMax = aplite ? 219 : 299;
  var coastMax = aplite ? 239 : 299;
  var dict = {
    Status: 0,
    DetailIndex: index,
    DayExtended: clip(d.extended || d.precis, extMax)
  };
  if (coastalOn()) {
    dict.HasCoastal = 1;
    dict.DayCoastal = clip((d.coastal || '').replace(/\t/g, ' '), coastMax);
  }
  send(dict);
}

function radarRangeSetting() {
  var r = loadSettings().RadarRange;
  if (r === 'national' || r === 'National') return 'national';
  if (r === 'state' || r === 'State' || r === 3 || r === '3') return 'state';
  var n = parseInt(r, 10);
  if (n === 64 || n === 256 || n === 512) return n;
  return 128;
}

function radarOverlays() {
  var s = loadSettings();
  function on(key, fallback) {
    if (s[key] === undefined || s[key] === null || s[key] === '') return fallback;
    return s[key] === true || s[key] === 1 || s[key] === '1';
  }
  return {
    crosshair: on('RadarOvCrosshair', true),
    topography: on('RadarOvTopography', true),
    catchments: on('RadarOvCatchments', true),
    waterways: on('RadarOvWaterways', true),
    roads: on('RadarOvRoads', true),
    rail: on('RadarOvRail', true),
    range: on('RadarOvRange', true),
    locations: on('RadarOvLocations', true)
  };
}

function radarProductId(siteId, range) {
  if (range === 'national' || range === 'state') return 'IDR00004';
  var digit = '3';
  if (range === 64) digit = '4';
  else if (range === 256) digit = '2';
  else if (range === 512) digit = '1';
  if (!siteId) return siteId;
  return siteId.slice(0, -1) + digit;
}

function parseRadarRange(hint) {
  if (hint === 1 || hint === '1' || hint === 'national') return 'national';
  if (hint === 3 || hint === '3' || hint === 'state') return 'state';
  var n = parseInt(hint, 10);
  if (n === 64 || n === 128 || n === 256 || n === 512) return n;
  return radarRangeSetting();
}

function radarRangeCode(range) {
  if (range === 'national') return 1;
  if (range === 'state') return 3;
  return range;
}

function stateBounds(state) {
  var s = String(state || '').toUpperCase();
  // Geographic extents so the crop contains the whole state, not the town.
  // ACT uses NSW: the territory is too small for a useful mosaic crop.
  var boxes = {
    NSW: { south: -37.51, north: -28.16, west: 140.99, east: 153.64 },
    ACT: { south: -37.51, north: -28.16, west: 140.99, east: 153.64 },
    VIC: { south: -39.20, north: -33.98, west: 140.96, east: 149.98 },
    QLD: { south: -29.18, north: -9.14, west: 137.99, east: 153.55 },
    SA: { south: -38.13, north: -25.99, west: 129.00, east: 141.00 },
    WA: { south: -35.13, north: -13.69, west: 112.92, east: 129.00 },
    TAS: { south: -43.74, north: -39.18, west: 143.74, east: 148.50 },
    NT: { south: -26.00, north: -10.97, west: 129.00, east: 138.00 }
  };
  return boxes[s] || boxes.NSW;
}

function sendRadar(displayW, displayH, rangeHint) {
  if (!hasRadar()) {
    return;
  }
  var gen = ++radarGen;
  var size = Math.min(displayW || 144, displayH || 144);
  if (size > 200) size = 200;
  if (size < 120) size = 120;
  var range = parseRadarRange(rangeHint);
  var national = range === 'national';
  var stateZoom = range === 'state';
  var mosaic = national || stateZoom;
  var explicit = rangeHint === 1 || rangeHint === '1' || rangeHint === 3 || rangeHint === '3' ||
    rangeHint === 64 || rangeHint === 128 || rangeHint === 256 || rangeHint === 512 ||
    rangeHint === '64' || rangeHint === '128' || rangeHint === '256' || rangeHint === '512' ||
    rangeHint === 'national' || rangeHint === 'state';
  var rangeCode = radarRangeCode(range);

  function stillCurrent() {
    return gen === radarGen;
  }

  function sendR(dict, success, fail) {
    dict.RadarRange = rangeCode;
    send(dict, success, fail);
  }

  sendR({ Status: 1 });

  function start(loc) {
    var site = loc && loc.id ? loc : (loc ? bom.nearestRadar(loc.lat, loc.lon) : null);
    if (!mosaic && !site) {
      if (!stillCurrent()) return;
      sendR({ Status: 3, RadarFrameCount: 0 });
      return;
    }
    var townLat = loc && (loc.townLat != null ? loc.townLat : loc.lat);
    var townLon = loc && (loc.townLon != null ? loc.townLon : loc.lon);
    var productId = mosaic ? 'IDR00004' : radarProductId(site.id, range);
    var state = (loc && (loc.s || loc.state)) || (lastForecast && lastForecast.state) || '';
    sendingRadar = true;
    radar.fetchFrames(productId, size, {
      townLat: townLat,
      townLon: townLon,
      radarLat: mosaic ? -27.0 : (site && site.lat),
      radarLon: mosaic ? 133.5 : (site && site.lon),
      rangeKm: mosaic ? 2150 : range,
      radiusFrac: mosaic ? 0.5 : 0.47,
      overlays: mosaic ? { locations: radarOverlays().locations } : radarOverlays(),
      overlayProductId: mosaic ? 'IDE00035' : undefined,
      skipCrosshair: !radarOverlays().crosshair,
      skipFallback: mosaic || explicit,
      cropFrac: national ? 0.02 : (stateZoom ? 0 : 0.16),
      zoomBounds: stateZoom ? stateBounds(state) : undefined,
      intervalMin: mosaic ? 10 : 6,
      offsetMin: mosaic ? 8 : 0,
      bw: isBwWatch()
    }, function (err, pngs, usedId) {
      if (!stillCurrent()) return;
      if (usedId && usedId !== productId && usedId.charAt(usedId.length - 1) === '3') {
        rangeCode = 128;
      }
      if (err || !pngs || !pngs.length) {
        radar.fetchNotice(productId, national ? 'National radar' : (stateZoom ? 'State radar' : (site && site.n)), function (nErr, notice) {
          if (!stillCurrent()) return;
          sendingRadar = false;
          console.log('radar err ' + (err && err.message));
          sendR({
            Status: 3,
            RadarFrameCount: 0,
            RadarNotice: clip(notice || 'Radar unavailable', 239)
          });
        });
        return;
      }
      radar.sendPngs(pngs, sendR, function () {
        if (stillCurrent()) sendingRadar = false;
      }, stillCurrent);
    });
  }

  if (lastForecast && lastForecast.radar) {
    start({
      id: lastForecast.radar.id,
      lat: lastForecast.radar.lat,
      lon: lastForecast.radar.lon,
      townLat: lastForecast.lat,
      townLon: lastForecast.lon,
      s: lastForecast.state
    });
    return;
  }

  resolveLocation(function (err, loc) {
    if (!stillCurrent()) return;
    if (err || !loc) {
      sendR({ Status: 2, RadarFrameCount: 0 });
      return;
    }
    start(loc);
  });
}

function sendSynoptic(displayW, displayH) {
  if (!hasRadar()) {
    return;
  }
  var gen = ++radarGen;
  var size = Math.min(displayW || 144, displayH || 144);
  if (size > 200) size = 200;
  if (size < 120) size = 120;

  function stillCurrent() {
    return gen === radarGen;
  }

  function sendS(dict, success, fail) {
    dict.RadarRange = 2;
    send(dict, success, fail);
  }

  sendS({ Status: 1 });
  sendingRadar = true;
  radar.fetchSynoptic(size, function (err, pngs) {
    if (!stillCurrent()) return;
    if (err || !pngs || !pngs.length) {
      sendingRadar = false;
      sendS({
        Status: 3,
        RadarFrameCount: 0,
        RadarNotice: 'Synoptic chart unavailable'
      });
      return;
    }
    radar.sendPngs(pngs, sendS, function () {
      if (stillCurrent()) sendingRadar = false;
    }, stillCurrent);
  }, isBwWatch());
}

function parseClosedResponse(response) {
  if (!response) return null;
  var attempts = [response];
  try { attempts.push(decodeURIComponent(response)); } catch (e) {}
  try { attempts.push(decodeURIComponent(decodeURIComponent(response))); } catch (e) {}
  for (var i = 0; i < attempts.length; i++) {
    try {
      var obj = JSON.parse(attempts[i]);
      if (obj && typeof obj === 'object') return obj;
    } catch (e) {}
  }
  return null;
}

function autoLocationLabel() {
  if (lastForecast && lastForecast.location) {
    return lastForecast.location + (lastForecast.state ? ', ' + lastForecast.state : '');
  }
  var last = loadLastLoc();
  if (last && last.n) return last.n + (last.s ? ', ' + last.s : '');
  return 'Not detected yet';
}

function townsBlob() {
  var list = bom.getTowns();
  var lines = [];
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    lines.push([t.n, t.s || '', t.lat || '', t.lon || ''].join('\t'));
  }
  return lines.join('\n');
}

function postcodesBlob() {
  var lines = [];
  for (var i = 0; i < postcodes.length; i++) {
    var p = postcodes[i];
    lines.push(p.pc + '\t' + p.lat + '\t' + p.lon);
  }
  return lines.join('\n');
}

function refreshStatusText() {
  try {
    var saved = localStorage.getItem('bomTownRefreshStatus');
    if (saved) return saved;
  } catch (e) {}
  return bom.getTowns().length + ' towns';
}

function watchPlatform() {
  try {
    if (typeof Pebble.getActiveWatchInfo !== 'function') return '';
    var info = Pebble.getActiveWatchInfo();
    return (info && info.platform) || '';
  } catch (e) {
    return '';
  }
}

function openConfig() {
  Pebble.openURL(config.toUrl(loadSettings(), {
    autoLocation: autoLocationLabel(),
    townsBlob: townsBlob(),
    postcodesBlob: postcodesBlob(),
    townCount: bom.getTowns().length,
    refreshStatus: refreshStatusText(),
    showRadar: hasRadar()
  }));
}

Pebble.addEventListener('ready', function () {
  bom.loadSavedTowns();
  fetchForecast();
});

Pebble.addEventListener('appmessage', function (e) {
  var p = e.payload || {};
  var type = payloadInt(p, 'RequestType');
  console.log('appmessage type=' + type + ' keys=' + Object.keys(p).join(','));
  if (type === 1) {
    sendDetail(payloadInt(p, 'DetailIndex'));
  } else if (type === 2) {
    sendRadar(p.DisplayW, p.DisplayH, p.DetailIndex);
  } else if (type === 3) {
    sendSynoptic(p.DisplayW, p.DisplayH);
  } else if (type === 5) {
    sendWarnBody(payloadInt(p, 'DetailIndex'));
  } else {
    fetchForecast();
  }
});

Pebble.addEventListener('showConfiguration', function () {
  openConfig();
});

Pebble.addEventListener('webviewclosed', function (e) {
  var settings = parseClosedResponse(e.response);
  if (!settings) return;
  if (settings.action === 'refreshTowns') {
    delete settings.action;
    saveSettings({
      LocationMode: settings.LocationMode,
      TownName: settings.TownName,
      RadarRange: settings.RadarRange || loadSettings().RadarRange,
      RadarOvCrosshair: settings.RadarOvCrosshair,
      RadarOvLocations: settings.RadarOvLocations,
      RadarOvCatchments: settings.RadarOvCatchments,
      RadarOvRail: settings.RadarOvRail,
      RadarOvRange: settings.RadarOvRange,
      RadarOvRoads: settings.RadarOvRoads,
      RadarOvTopography: settings.RadarOvTopography,
      RadarOvWaterways: settings.RadarOvWaterways,
      CoastalDetails: settings.CoastalDetails,
      Theme: settings.Theme
    });
    try { localStorage.setItem('bomTownRefreshStatus', 'Refreshing...'); } catch (err) {}
    bom.fetchTownList(function (err, list) {
      var msg = err ? 'Failed!' : 'Updated!';
      try { localStorage.setItem('bomTownRefreshStatus', msg); } catch (err2) {}
      setTimeout(openConfig, 250);
    });
    return;
  }
  saveSettings(settings);
  send({ Theme: themeLight() ? 1 : 0 });
  fetchForecast();
});
