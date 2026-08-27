var bundledTowns = require('./locations');
var postcodes = require('./postcodes');
var radars = require('./radars');
var coasts = require('./coasts');

var towns = bundledTowns;

var STATE_PRODUCTS = [
  {p: 'IDN11060', s: 'NSW'},
  {p: 'IDV10753', s: 'VIC'},
  {p: 'IDQ11295', s: 'QLD'},
  {p: 'IDS10044', s: 'SA'},
  {p: 'IDW14199', s: 'WA'},
  {p: 'IDT16710', s: 'TAS'},
  {p: 'IDD10207', s: 'NT'}
];

/* Town precis products have no UV. These city/district forecasts do. */
var UV_BY_STATE = {
  NSW: 'IDN11050',
  ACT: 'IDN11050',
  VIC: 'IDV10752',
  QLD: 'IDQ11296',
  SA: 'IDS10034',
  WA: 'IDW14100',
  TAS: 'IDT13630',
  NT: 'IDD10208'
};

var COAST_PRODUCTS = {
  NSW: 'IDN11001',
  ACT: 'IDN11001',
  NT: 'IDD11030',
  QLD: 'IDQ11290',
  SA: 'IDS11072',
  TAS: 'IDT12329',
  VIC: 'IDV10200',
  WA: 'IDW11160'
};

var UV_AREA_ALIASES = {
  'darwin city and outer darwin': 'Darwin',
  'geelong and surf coast': 'Geelong',
  'mornington peninsula': 'Mornington',
  'sunshine coast': 'Caloundra',
  'central coast': 'Gosford',
  'alpine': 'Jindabyne',
  'gold coast': 'Surfers Paradise'
};

function decodeXml(s) {
  if (!s) return '';
  return s.replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) {
      return String.fromCharCode(parseInt(h, 16));
    })
    .replace(/&#(\d+);/g, function (_, n) {
      return String.fromCharCode(+n);
    });
}

function collapseSpace(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
}

function pebbleSafe(s) {
  s = decodeXml(String(s || ''));
  s = s.replace(/[\u00a0\u202f]/g, ' ');
  s = s.replace(/[\u2018\u2019\u2032]/g, "'");
  s = s.replace(/[\u201c\u201d]/g, '"');
  s = s.replace(/[\u2013\u2014\u2212]/g, '-');
  s = s.replace(/\u2026/g, '...');
  var out = '';
  var i;
  for (i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 255)) {
      out += s.charAt(i);
    } else {
      out += ' ';
    }
  }
  return collapseSpace(out);
}

function cleanWarnTitle(title) {
  title = pebbleSafe(title);
  title = title.replace(/^\d{1,2}\/\d{1,2}:\d{2}(?::\d{2})?\s+[A-Z]{2,5}\s+/i, '');
  return title;
}

function xhrOk(req, minLen) {
  var text = req.responseText || '';
  var okStatus = (req.status >= 200 && req.status < 300) ||
    (req.status === 0 && text.length >= (minLen || 50));
  return okStatus;
}

function xhrText(url, cb) {
  var req = new XMLHttpRequest();
  var done = false;
  function finish(err, text) {
    if (done) return;
    done = true;
    cb(err, text);
  }
  function handle() {
    if (typeof req.readyState !== 'undefined' && req.readyState !== 4) return;
    if (xhrOk(req, 50)) finish(null, req.responseText);
    else finish(new Error('HTTP ' + req.status));
  }
  req.open('GET', url, true);
  req.onreadystatechange = handle;
  req.onload = handle;
  req.onerror = function () {
    finish(new Error('network'));
  };
  req.ontimeout = function () {
    finish(new Error('timeout'));
  };
  try {
    req.timeout = 20000;
  } catch (e) {}
  req.send();
}

function xhrTextFallback(path, cb) {
  var urls = [
    'https://reg.bom.gov.au/fwo/' + path,
    'http://reg.bom.gov.au/fwo/' + path,
    'https://www.bom.gov.au/fwo/' + path,
    'http://www.bom.gov.au/fwo/' + path
  ];
  var i = 0;
  function next() {
    if (i >= urls.length) {
      cb(new Error('network'));
      return;
    }
    var url = urls[i++];
    xhrText(url, function (err, text) {
      if (err) next();
      else cb(null, text);
    });
  }
  next();
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

function hasCoords(t) {
  return t && typeof t.lat === 'number' && typeof t.lon === 'number' &&
    !(t.lat === 0 && t.lon === 0);
}

function nearestFrom(list, lat, lon) {
  var best = null;
  var bestD = 1e9;
  for (var i = 0; i < list.length; i++) {
    if (!hasCoords(list[i])) continue;
    var d = haversine(lat, lon, list[i].lat, list[i].lon);
    if (d < bestD) {
      bestD = d;
      best = list[i];
    }
  }
  return best;
}

function nearestTowns(lat, lon, n) {
  n = n || 3;
  var scored = [];
  for (var i = 0; i < towns.length; i++) {
    var t = towns[i];
    if (!hasCoords(t)) continue;
    scored.push({ t: t, d: haversine(lat, lon, t.lat, t.lon) });
  }
  scored.sort(function (a, b) { return a.d - b.d; });
  var out = [];
  for (var j = 0; j < scored.length && j < n; j++) {
    var item = scored[j];
    out.push({
      n: item.t.n,
      s: item.t.s,
      aac: item.t.aac,
      lat: item.t.lat,
      lon: item.t.lon,
      p: item.t.p,
      c: item.t.c,
      km: Math.round(item.d)
    });
  }
  return out;
}

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^\s+|\s+$/g, '');
}

function findTown(query) {
  var q = normalize(query);
  if (!q) return null;
  var parts = q.split(' ');
  var stateHint = '';
  var last = parts[parts.length - 1];
  if (/^(nsw|vic|qld|sa|wa|tas|nt|act)$/.test(last)) {
    stateHint = last.toUpperCase();
    parts.pop();
    q = parts.join(' ');
  }
  if (!q) return null;

  var exact = null;
  var start = null;
  for (var i = 0; i < towns.length; i++) {
    var t = towns[i];
    if (stateHint && t.s !== stateHint) continue;
    var n = normalize(t.n);
    if (n === q) {
      exact = t;
      break;
    }
    if (!start && q.length >= 3 && n.indexOf(q) === 0) start = t;
  }
  return exact || start;
}

function findPostcode(pc) {
  pc = String(pc || '').replace(/\D/g, '');
  if (pc.length !== 4) return null;
  for (var i = 0; i < postcodes.length; i++) {
    if (postcodes[i].pc === pc) return postcodes[i];
  }
  return null;
}

function xmlAttr(attrs, name) {
  var m = attrs.match(new RegExp(name + '="([^"]*)"'));
  return m ? decodeXml(m[1]) : '';
}

function stateFromAac(aac, fallback) {
  if (!aac) return fallback || '';
  if (aac.indexOf('NSW_') === 0) return 'NSW';
  if (aac.indexOf('VIC_') === 0) return 'VIC';
  if (aac.indexOf('QLD_') === 0) return 'QLD';
  if (aac.indexOf('SA_') === 0) return 'SA';
  if (aac.indexOf('WA_') === 0) return 'WA';
  if (aac.indexOf('TAS_') === 0) return 'TAS';
  if (aac.indexOf('NT_') === 0) return 'NT';
  return fallback || '';
}

function parseLocationAreas(xml, productId, stateHint) {
  var out = [];
  var re = /<area\b([^>]*)>/g;
  var m;
  while ((m = re.exec(xml))) {
    var attrs = m[1];
    if (xmlAttr(attrs, 'type') !== 'location') continue;
    var aac = xmlAttr(attrs, 'aac');
    var name = xmlAttr(attrs, 'description');
    if (!aac || !name) continue;
    out.push({
      n: name,
      s: stateFromAac(aac, stateHint),
      aac: aac,
      lat: 0,
      lon: 0,
      p: productId
    });
  }
  return out;
}

function copyTown(t) {
  var o = { n: t.n, s: t.s, aac: t.aac, lat: t.lat, lon: t.lon, p: t.p };
  if (t.c) o.c = t.c;
  return o;
}

function mergeTowns(base, incoming) {
  var byAac = {};
  var i;
  for (i = 0; i < base.length; i++) {
    if (base[i].aac) byAac[base[i].aac] = copyTown(base[i]);
  }
  for (i = 0; i < incoming.length; i++) {
    var t = incoming[i];
    var old = byAac[t.aac];
    if (old) {
      old.n = t.n || old.n;
      old.p = t.p || old.p;
      if (!old.s) old.s = t.s;
    } else {
      byAac[t.aac] = copyTown(t);
    }
  }
  var list = [];
  for (var k in byAac) {
    if (byAac.hasOwnProperty(k)) list.push(byAac[k]);
  }
  list.sort(function (a, b) {
    return (a.n || '').localeCompare(b.n || '');
  });
  return list;
}

function loadSavedTowns() {
  try {
    var saved = JSON.parse(localStorage.getItem('bomTowns') || 'null');
    if (saved && saved.length) {
      towns = mergeTowns(bundledTowns, saved);
    }
  } catch (e) {}
}

function saveTowns(list) {
  towns = list;
  try {
    localStorage.setItem('bomTowns', JSON.stringify(list));
  } catch (e) {}
}

function getTowns() {
  return towns;
}

function fetchTownList(cb) {
  var collected = [];
  var pending = STATE_PRODUCTS.length;
  var any = false;
  function one(err, xml, product) {
    if (!err && xml) {
      any = true;
      collected = collected.concat(parseLocationAreas(xml, product.p, product.s));
    }
    pending--;
    if (pending > 0) return;
    if (!any || !collected.length) {
      cb(new Error('no towns'));
      return;
    }
    var merged = mergeTowns(towns, collected);
    saveTowns(merged);
    cb(null, merged);
  }
  for (var i = 0; i < STATE_PRODUCTS.length; i++) {
    (function (product) {
      xhrTextFallback(product.p + '.xml', function (err, xml) {
        one(err, xml, product);
      });
    })(STATE_PRODUCTS[i]);
  }
}

function resolveQuery(query, cb) {
  var raw = (query || '').trim();
  if (!raw) return cb(new Error('notfound'));
  var pcMatch = raw.match(/\b(\d{4})\b/);
  if (/^\d{4}$/.test(raw) || (pcMatch && !findTown(raw))) {
    var pc = findPostcode(pcMatch ? pcMatch[1] : raw);
    if (pc) return cb(null, nearestTown(pc.lat, pc.lon));
    if (/^\d{4}$/.test(raw)) return cb(new Error('notfound'));
  }
  var named = findTown(raw);
  if (named) return cb(null, named);
  cb(new Error('notfound'));
}

function nearestTown(lat, lon) {
  return nearestFrom(towns, lat, lon);
}

function nearestRadar(lat, lon) {
  return nearestFrom(radars, lat, lon);
}

function innerByAac(xml, aac) {
  var tag = '<area aac="' + aac + '"';
  var start = xml.indexOf(tag);
  if (start < 0) return null;
  var openEnd = xml.indexOf('>', start);
  if (openEnd < 0) return null;
  var innerStart = openEnd + 1;
  var nested = xml.indexOf('<area ', innerStart);
  var close = xml.indexOf('</area>', innerStart);
  if (close < 0) return null;
  var end = (nested >= 0 && nested < close) ? nested : close;
  return xml.slice(innerStart, end);
}

function innerByDescription(xml, name, type) {
  var want = name.toLowerCase();
  var re = new RegExp('<area aac="([^"]+)" description="([^"]+)" type="' + type + '"', 'g');
  var m;
  while ((m = re.exec(xml))) {
    if (m[2].toLowerCase() === want) {
      return innerByAac(xml, m[1]);
    }
  }
  return null;
}

function parsePeriods(inner) {
  if (!inner) return [];
  var periods = [];
  var parts = inner.split('<forecast-period ');
  for (var i = 1; i < parts.length; i++) {
    var p = parts[i];
    var end = p.indexOf('</forecast-period>');
    if (end < 0) continue;
    var body = p.slice(0, end);
    function el(type) {
      var rx = new RegExp('<element type="' + type + '"[^>]*>([^<]*)</element>');
      var mm = body.match(rx);
      return mm ? decodeXml(mm[1]) : '';
    }
    function tx(type) {
      var rx = new RegExp('<text type="' + type + '">([^<]*)</text>');
      var mm = body.match(rx);
      return mm ? decodeXml(mm[1]) : '';
    }
    var idx = body.match(/index="(\d+)"/);
    var start = body.match(/start-time-local="([^"]+)"/);
    periods.push({
      index: idx ? +idx[1] : periods.length,
      start: start ? start[1] : '',
      min: el('air_temperature_minimum'),
      max: el('air_temperature_maximum'),
      precis: tx('precis'),
      forecast: tx('forecast'),
      pop: tx('probability_of_precipitation'),
      rain: el('precipitation_range'),
      uv: el('uv_alert') || tx('uv_alert') || tx('uv'),
      icon: el('forecast_icon_code')
    });
  }
  return periods;
}

function ymdFromIso(iso) {
  var m = (iso || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function addYmd(ymd, days) {
  var m = (ymd || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
  return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
}

function localYmd(state) {
  var tz = {
    WA: 'Australia/Perth',
    SA: 'Australia/Adelaide',
    NT: 'Australia/Darwin',
    QLD: 'Australia/Brisbane'
  }[state] || 'Australia/Sydney';
  try {
    return new Date().toLocaleString('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).slice(0, 10);
  } catch (e) {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
}

function dayLabel(iso) {
  var m = (iso || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return 'Day';
  var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return names[dt.getUTCDay()] + ' ' + (+m[3]);
}

function dayTitle(iso) {
  var m = (iso || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return 'Day';
  var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  var names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return names[dt.getUTCDay()] + ' ' + (+m[3]) + ' ' + months[+m[2] - 1];
}

function shortUv(raw) {
  if (!raw) return '';
  var m = String(raw).match(/\[([^\]]+)\]/);
  if (m) return m[1];
  m = String(raw).match(/UV Index[^0-9]{0,20}([0-9]+)/i);
  if (m) return m[1];
  m = String(raw).match(/\b(Extreme|Very high|Very High|High|Moderate|Low)\b/i);
  if (m) return m[1];
  return String(raw).replace(/\.$/, '').slice(0, 15);
}

function weatherIcon(code, precis, rainChance) {
  var n = parseInt(code, 10);
  if (n === 1 || n === 2) return 1;
  if (n === 3) return 2;
  if (n === 4 || n === 6 || n === 13) return 3;
  if (n === 11 || n === 17) return 4;
  if (n === 8 || n === 12 || n === 18) return 5;
  if (n === 16 || n === 19) return 6;
  if (n === 9) return 7;
  if (n === 10 || n === 14) return 8;
  if (n === 15) return 9;
  var p = (precis || '').toLowerCase();
  if (/storm|thunder|cyclone/.test(p)) return 6;
  if (/snow|hail/.test(p)) return 9;
  if (/fog|mist|frost/.test(p)) return 8;
  if (/wind/.test(p)) return 7;
  if (/shower/.test(p)) return 4;
  if (/rain|drizzle/.test(p)) return 5;
  if (/cloud|overcast|hazy|haze/.test(p)) return 3;
  if (/partly/.test(p)) return 2;
  if (/sunny|clear|fine/.test(p)) return 1;
  if (rainChance >= 70) return 5;
  if (rainChance >= 40) return 4;
  return 2;
}

function toDays(periods, state) {
  var today = localYmd(state);
  var tomorrow = addYmd(today, 1);
  var days = [];
  for (var i = 0; i < periods.length && days.length < 7; i++) {
    var p = periods[i];
    var pop = (p.pop || '').replace('%', '');
    var rainChance = pop === '' ? -1 : parseInt(pop, 10);
    var precis = (p.precis || '').replace(/\.$/, '');
    var ymd = ymdFromIso(p.start);
    var name = dayLabel(p.start);
    if (ymd && ymd === today) name = 'Today - ' + name;
    else if (ymd && ymd === tomorrow) name = 'Tomorrow - ' + name;
    days.push({
      name: name,
      title: dayTitle(p.start),
      ymd: ymd,
      min: p.min === '' ? 99 : parseInt(p.min, 10),
      max: p.max === '' ? 99 : parseInt(p.max, 10),
      precis: precis,
      rainChance: rainChance,
      rainAmount: p.rain || '',
      uv: shortUv(p.uv),
      extended: p.forecast || '',
      icon: weatherIcon(p.icon, precis, rainChance)
    });
  }
  return days;
}

function extraForDay(day, i, extraPeriods) {
  if (!extraPeriods || !extraPeriods.length) return null;
  var byYmd = null;
  var byIdx = null;
  for (var j = 0; j < extraPeriods.length; j++) {
    var e = extraPeriods[j];
    if (day.ymd && ymdFromIso(e.start) === day.ymd) byYmd = e;
    if (e.index === i) byIdx = e;
  }
  return byYmd || byIdx || extraPeriods[i] || null;
}

function mergeExtended(days, extraPeriods) {
  if (!extraPeriods) return days;
  for (var i = 0; i < days.length; i++) {
    var extra = extraForDay(days[i], i, extraPeriods);
    if (!extra) continue;
    if (!days[i].extended && extra.forecast) {
      days[i].extended = extra.forecast;
    }
    if (!days[i].uv && extra.uv) {
      days[i].uv = shortUv(extra.uv);
    }
  }
  return days;
}

function parentAac(xml, aac) {
  if (!xml || !aac) return '';
  var esc = aac.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var m = xml.match(new RegExp('<area aac="' + esc + '"([^>]*)>'));
  return m ? xmlAttr(m[1], 'parent-aac') : '';
}

function periodsHaveUv(periods) {
  if (!periods) return false;
  for (var i = 0; i < periods.length; i++) {
    if (periods[i].uv) return true;
  }
  return false;
}

function coordsForAreaName(name) {
  if (!name) return null;
  var alias = UV_AREA_ALIASES[name.toLowerCase()];
  var t = findTown(alias || name);
  if (t && hasCoords(t)) return t;
  var first = name.split(/ and | & | \/ |,/)[0].trim();
  if (first && first !== name) {
    t = findTown(first);
    if (t && hasCoords(t)) return t;
  }
  return null;
}

function nearestMetroPeriods(uvXml, loc) {
  var re = /<area aac="([^"]+)" description="([^"]+)" type="metropolitan"/g;
  var m;
  var bestAac = '';
  var bestD = 1e9;
  var firstAac = '';
  while ((m = re.exec(uvXml))) {
    if (!firstAac) firstAac = m[1];
    var place = coordsForAreaName(m[2]);
    if (!place || !hasCoords(loc)) continue;
    var d = haversine(loc.lat, loc.lon, place.lat, place.lon);
    if (d < bestD) {
      bestD = d;
      bestAac = m[1];
    }
  }
  var inner = innerByAac(uvXml, bestAac || firstAac);
  var periods = parsePeriods(inner);
  return periodsHaveUv(periods) ? periods : [];
}

function uvPeriodsForLoc(uvXml, precisXml, loc) {
  var seen = {};
  function tryAac(aac) {
    if (!aac || seen[aac]) return null;
    seen[aac] = true;
    var periods = parsePeriods(innerByAac(uvXml, aac));
    return periodsHaveUv(periods) ? periods : null;
  }

  var found = tryAac(loc && loc.aac);
  if (found) return found;

  var aac = loc && loc.aac;
  var i;
  for (i = 0; i < 8 && aac; i++) {
    var parent = parentAac(precisXml, aac) || parentAac(uvXml, aac);
    found = tryAac(parent);
    if (found) return found;
    aac = parent;
  }

  var types = ['metropolitan', 'location', 'public-district'];
  for (i = 0; i < types.length; i++) {
    found = parsePeriods(innerByDescription(uvXml, loc.n, types[i]));
    if (periodsHaveUv(found)) return found;
  }

  return nearestMetroPeriods(uvXml, loc);
}

function districtName(xml, aac) {
  if (!xml || !aac) return '';
  var esc = aac.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var m = xml.match(new RegExp('<area aac="' + esc + '"([^>]*)>'));
  if (!m) return '';
  var parent = xmlAttr(m[1], 'parent-aac');
  if (!parent) return '';
  var p = xml.match(new RegExp('<area aac="' + parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"([^>]*)>'));
  return p ? xmlAttr(p[1], 'description') : '';
}

var OBS_PRODUCTS = {
  NSW: 'IDN60920',
  ACT: 'IDN60920',
  VIC: 'IDV60920',
  QLD: 'IDQ60920',
  SA: 'IDS60920',
  WA: 'IDW60920',
  TAS: 'IDT60920',
  NT: 'IDD60920'
};

function parseObsStations(xml) {
  var stations = [];
  if (!xml) return stations;
  var parts = xml.split('<station ');
  for (var i = 1; i < parts.length; i++) {
    var chunk = parts[i];
    var end = chunk.indexOf('</station>');
    if (end < 0) continue;
    var body = chunk.slice(0, end);
    var head = body.split('>')[0] || '';
    function el(type) {
      var rx = new RegExp('<element[^>]*type="' + type + '"[^>]*>([^<]*)</element>');
      var mm = body.match(rx);
      if (mm) return decodeXml(mm[1]);
      rx = new RegExp('<element[^>]*type="' + type.replace('-', '_') + '"[^>]*>([^<]*)</element>');
      mm = body.match(rx);
      return mm ? decodeXml(mm[1]) : '';
    }
    var lat = parseFloat(xmlAttr(head, 'lat'));
    var lon = parseFloat(xmlAttr(head, 'lon'));
    if (!isFinite(lat) || !isFinite(lon)) continue;
    stations.push({
      name: xmlAttr(head, 'stn-name') || xmlAttr(head, 'description'),
      lat: lat,
      lon: lon,
      temp: el('air_temperature') || el('air_temp'),
      hum: el('rel-humidity') || el('rel_hum'),
      deltaT: el('delta_t'),
      apparent: el('apparent_temp') || el('apparent_t'),
      msl: el('msl_pres') || el('pres'),
      windDir: el('wind_dir'),
      windKmh: el('wind_spd_kmh'),
      gust: el('gust_kmh') || el('maximum_gust_kmh'),
      dew: el('dew_point'),
      rain: el('rainfall') || el('rain_hour')
    });
  }
  return stations;
}

var MSL_NEAR_KM = 100;
var MSL_INTERP_KM = 250;

var OBS_NEIGHBOURS = {
  NSW: ['VIC', 'QLD', 'SA'],
  ACT: ['VIC', 'QLD', 'SA'],
  VIC: ['NSW', 'SA', 'TAS'],
  QLD: ['NSW', 'NT', 'SA'],
  SA: ['NSW', 'VIC', 'QLD', 'WA', 'NT'],
  WA: ['SA', 'NT'],
  TAS: ['VIC'],
  NT: ['QLD', 'SA', 'WA']
};

function numOrNull(v) {
  if (v === '' || v == null) return null;
  var n = parseFloat(v);
  return isFinite(n) ? n : null;
}

function dewFromTempHum(t, h) {
  if (t == null || h == null || h <= 0) return null;
  var g = Math.log(h / 100) + (17.625 * t) / (243.04 + t);
  var d = 17.625 - g;
  if (Math.abs(d) < 1e-9) return null;
  var dew = 243.04 * g / d;
  return isFinite(dew) ? dew : null;
}

function humFromTempDew(t, dew) {
  if (t == null || dew == null) return null;
  var eT = Math.exp((17.625 * t) / (243.04 + t));
  var eD = Math.exp((17.625 * dew) / (243.04 + dew));
  if (!eT) return null;
  var h = 100 * eD / eT;
  if (h < 0) h = 0;
  if (h > 100) h = 100;
  return isFinite(h) ? h : null;
}

function wetBulbStull(t, rh) {
  if (t == null || rh == null) return null;
  var tw = t * Math.atan(0.151977 * Math.pow(rh + 8.313659, 0.5)) +
    Math.atan(t + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
    4.686035;
  return isFinite(tw) ? tw : null;
}

function vapourPressure(t, rh) {
  if (t == null || rh == null) return null;
  return (rh / 100) * 6.105 * Math.exp(17.27 * t / (237.7 + t));
}

function apparentSteadman(t, rh, windKmh) {
  if (t == null || rh == null || windKmh == null) return null;
  var e = vapourPressure(t, rh);
  if (e == null) return null;
  var ws = windKmh / 3.6;
  var at = t + 0.33 * e - 0.70 * ws - 4.00;
  return isFinite(at) ? at : null;
}

function bearingTo(lat, lon, slat, slon) {
  var dlon = (slon - lon) * Math.PI / 180;
  var y = Math.sin(dlon) * Math.cos(slat * Math.PI / 180);
  var x = Math.cos(lat * Math.PI / 180) * Math.sin(slat * Math.PI / 180) -
    Math.sin(lat * Math.PI / 180) * Math.cos(slat * Math.PI / 180) * Math.cos(dlon);
  return Math.atan2(y, x);
}

function stationsSurround(lat, lon, stations) {
  if (!stations || stations.length < 3) return false;
  var br = [];
  var i;
  for (i = 0; i < stations.length; i++) {
    br.push(bearingTo(lat, lon, stations[i].lat, stations[i].lon));
  }
  br.sort(function (a, b) { return a - b; });
  for (i = 0; i < br.length; i++) {
    var next = i + 1 < br.length ? br[i + 1] : br[0] + Math.PI * 2;
    if (next - br[i] >= Math.PI) return false;
  }
  return true;
}

function solve3(m, rhs) {
  var a = [
    [m[0][0], m[0][1], m[0][2], rhs[0]],
    [m[1][0], m[1][1], m[1][2], rhs[1]],
    [m[2][0], m[2][1], m[2][2], rhs[2]]
  ];
  var i;
  var r;
  var c;
  for (i = 0; i < 3; i++) {
    var piv = i;
    for (r = i + 1; r < 3; r++) {
      if (Math.abs(a[r][i]) > Math.abs(a[piv][i])) piv = r;
    }
    if (Math.abs(a[piv][i]) < 1e-12) return null;
    var tmp = a[i];
    a[i] = a[piv];
    a[piv] = tmp;
    var d = a[i][i];
    for (c = i; c < 4; c++) a[i][c] /= d;
    for (r = 0; r < 3; r++) {
      if (r === i) continue;
      var f = a[r][i];
      for (c = i; c < 4; c++) a[r][c] -= f * a[i][c];
    }
  }
  return [a[0][3], a[1][3], a[2][3]];
}

function planarMsl(lat, lon, stations) {
  if (!stations || stations.length < 3) return null;
  var n = stations.length;
  var sumLat = 0;
  var sumLon = 0;
  var sumP = 0;
  var sumLat2 = 0;
  var sumLon2 = 0;
  var sumLatLon = 0;
  var sumLatP = 0;
  var sumLonP = 0;
  var i;
  for (i = 0; i < n; i++) {
    var slat = stations[i].lat;
    var slon = stations[i].lon;
    var p = stations[i].msl;
    sumLat += slat;
    sumLon += slon;
    sumP += p;
    sumLat2 += slat * slat;
    sumLon2 += slon * slon;
    sumLatLon += slat * slon;
    sumLatP += slat * p;
    sumLonP += slon * p;
  }
  var coef = solve3(
    [[n, sumLat, sumLon], [sumLat, sumLat2, sumLatLon], [sumLon, sumLatLon, sumLon2]],
    [sumP, sumLatP, sumLonP]
  );
  if (!coef) return null;
  var msl = coef[0] + coef[1] * lat + coef[2] * lon;
  return isFinite(msl) ? msl : null;
}

function mslDonorsWithin(list, lat, lon, maxKm) {
  var out = [];
  if (!list) return out;
  var i;
  for (i = 0; i < list.length; i++) {
    var st = list[i];
    if (!hasCoords(st)) continue;
    var msl = numOrNull(st.msl);
    if (msl == null) continue;
    var d = haversine(lat, lon, st.lat, st.lon);
    if (d > maxKm) continue;
    out.push({
      name: st.name || 'Observation site',
      lat: st.lat,
      lon: st.lon,
      msl: msl,
      km: d
    });
  }
  out.sort(function (a, b) { return a.km - b.km; });
  return out;
}

function fillThermo(obs) {
  if (!obs || !obs.calc) return;
  if (obs.dew == null && obs.temp != null && obs.hum != null) {
    var dew = dewFromTempHum(obs.temp, obs.hum);
    if (dew != null) {
      obs.dew = dew;
      obs.calc.dew = true;
    }
  }
  if (obs.hum == null && obs.temp != null && obs.dew != null) {
    var h = humFromTempDew(obs.temp, obs.dew);
    if (h != null) {
      obs.hum = h;
      obs.calc.hum = true;
    }
  }
  if (obs.deltaT == null && obs.temp != null && obs.hum != null) {
    var tw = wetBulbStull(obs.temp, obs.hum);
    if (tw != null) {
      obs.deltaT = obs.temp - tw;
      obs.calc.deltaT = true;
    }
  }
  if (obs.apparent == null && obs.temp != null && obs.hum != null && obs.windKmh != null) {
    var at = apparentSteadman(obs.temp, obs.hum, obs.windKmh);
    if (at != null) {
      obs.apparent = at;
      obs.calc.apparent = true;
    }
  }
}

function fillMsl(obs, list, lat, lon) {
  if (!obs || !obs.calc || obs.msl != null) return;
  var near = mslDonorsWithin(list, lat, lon, MSL_NEAR_KM);
  if (near.length) {
    obs.msl = near[0].msl;
    obs.calc.mslNearby = true;
    obs.calc.mslDonor = {
      name: near[0].name,
      km: Math.round(near[0].km)
    };
    return;
  }
  var wide = mslDonorsWithin(list, lat, lon, MSL_INTERP_KM);
  if (wide.length < 3 || !stationsSurround(lat, lon, wide)) return;
  var msl = planarMsl(lat, lon, wide);
  if (msl == null) return;
  obs.msl = msl;
  obs.calc.mslInterp = true;
}

function rawFromStation(stn) {
  if (!stn) return null;
  var dir = String(stn.windDir || '').replace(/-/g, '');
  var spd = numOrNull(stn.windKmh);
  var rain = String(stn.rain == null ? '' : stn.rain).replace(/^\s+|\s+$/g, '');
  if (rain === '-' || rain === 'n/a') rain = '';
  return {
    name: stn.name || '',
    lat: stn.lat,
    lon: stn.lon,
    temp: numOrNull(stn.temp),
    hum: numOrNull(stn.hum),
    deltaT: numOrNull(stn.deltaT),
    apparent: numOrNull(stn.apparent),
    msl: numOrNull(stn.msl),
    windDir: dir,
    windKmh: spd,
    gust: numOrNull(stn.gust),
    dew: numOrNull(stn.dew),
    rain: rain,
    calc: {
      hum: false,
      deltaT: false,
      apparent: false,
      dew: false,
      mslNearby: false,
      mslInterp: false,
      mslDonor: null
    }
  };
}

function roundFilledObs(obs) {
  if (!obs) return null;
  if (obs.temp != null) obs.temp = Math.round(obs.temp);
  if (obs.hum != null) obs.hum = Math.round(obs.hum);
  if (obs.deltaT != null) obs.deltaT = Math.round(obs.deltaT);
  if (obs.apparent != null) obs.apparent = Math.round(obs.apparent);
  if (obs.msl != null) obs.msl = Math.round(obs.msl * 10) / 10;
  if (obs.windKmh != null) obs.windKmh = Math.round(obs.windKmh);
  if (obs.gust != null) obs.gust = Math.round(obs.gust);
  if (obs.dew != null) obs.dew = Math.round(obs.dew);
  var dir = obs.windDir || '';
  var spd = obs.windKmh;
  var wind = '';
  if (dir && dir !== 'CALM' && spd != null) wind = dir + ' ' + spd + ' km/h';
  else if (dir === 'CALM' || spd === 0) wind = 'Calm';
  else if (dir) wind = dir;
  else if (spd != null) wind = spd + ' km/h';
  obs.wind = wind;
  obs.windDir = dir && dir !== 'CALM' ? dir : (spd === 0 ? 'Calm' : '');
  if (obs.temp == null && obs.hum == null && obs.deltaT == null && obs.apparent == null &&
      obs.msl == null && !wind && obs.gust == null && obs.dew == null && !obs.rain) {
    return null;
  }
  return obs;
}

function fillObsAt(lat, lon, list) {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !list || !list.length) return null;
  var nearest = nearestFrom(list, lat, lon);
  if (!nearest) return null;
  var obs = rawFromStation(nearest);
  if (!obs) return null;
  fillThermo(obs);
  fillMsl(obs, list, lat, lon);
  return roundFilledObs(obs);
}

function obsFillNotes(obs) {
  var notes = [];
  if (!obs || !obs.calc) return notes;
  var c = obs.calc;
  if (c.hum) notes.push('Humidity* \u2014 calculated');
  if (c.dew) notes.push('Dew* \u2014 calculated');
  if (c.deltaT) notes.push('Delta-T* \u2014 calculated');
  if (c.apparent) notes.push('Apparent* \u2014 calculated');
  if (c.mslNearby) {
    if (c.mslDonor && c.mslDonor.name) {
      notes.push('MSL^ \u2014 pulled from ' + c.mslDonor.name + ' (' + c.mslDonor.km + ' km)');
    } else {
      notes.push('MSL^ \u2014 pulled from nearby station');
    }
  }
  if (c.mslInterp) notes.push('MSL* \u2014 calculated from surrounding stations');
  return notes;
}

function obsCalcMask(obs) {
  if (!obs || !obs.calc) return 0;
  var c = obs.calc;
  var f = 0;
  if (c.hum) f |= 1;
  if (c.deltaT) f |= 2;
  if (c.apparent) f |= 4;
  if (c.dew) f |= 8;
  if (c.mslNearby) f |= 16;
  if (c.mslInterp) f |= 32;
  return f;
}

function obsPageHelpersSource() {
  return [
    'var MSL_NEAR_KM=' + MSL_NEAR_KM + ';',
    'var MSL_INTERP_KM=' + MSL_INTERP_KM + ';',
    haversine.toString(),
    hasCoords.toString(),
    nearestFrom.toString(),
    numOrNull.toString(),
    dewFromTempHum.toString(),
    humFromTempDew.toString(),
    wetBulbStull.toString(),
    vapourPressure.toString(),
    apparentSteadman.toString(),
    bearingTo.toString(),
    stationsSurround.toString(),
    solve3.toString(),
    planarMsl.toString(),
    mslDonorsWithin.toString(),
    fillThermo.toString(),
    fillMsl.toString(),
    rawFromStation.toString(),
    roundFilledObs.toString(),
    fillObsAt.toString(),
    obsFillNotes.toString()
  ].join('\n');
}

function parseObsJson(text) {
  try {
    var json = JSON.parse(text);
    var arr = json && json.observations && json.observations.data;
    if (!arr || !arr.length) return [];
    var stations = [];
    for (var i = 0; i < arr.length; i++) {
      var r = arr[i];
      var lat = parseFloat(r.lat);
      var lon = parseFloat(r.lon);
      if (!isFinite(lat) || !isFinite(lon)) continue;
      stations.push({
        name: r.name,
        lat: lat,
        lon: lon,
        temp: r.air_temp,
        hum: r.rel_hum,
        deltaT: r.delta_t,
        apparent: r.apparent_t,
        msl: r.press_msl || r.press,
        windDir: r.wind_dir,
        windKmh: r.wind_spd_kmh,
        gust: r.gust_kmh,
        dew: r.dewpt,
        rain: r.rain_trace
      });
    }
    return stations;
  } catch (e) {
    return [];
  }
}

function loadObsProduct(product, cb) {
  xhrTextFallback(product + '.xml', function (err, xml) {
    var stations = parseObsStations(xml);
    if (stations.length) return cb(stations);
    xhrTextFallback(product + '/' + product + '.json', function (jerr, text) {
      cb(parseObsJson(text || ''));
    });
  });
}

function mergeObsStations(a, b) {
  var seen = {};
  var out = [];
  function add(list) {
    if (!list) return;
    var i;
    for (i = 0; i < list.length; i++) {
      var s = list[i];
      if (!hasCoords(s)) continue;
      var k = s.lat.toFixed(4) + ',' + s.lon.toFixed(4);
      if (seen[k]) continue;
      seen[k] = true;
      out.push(s);
    }
  }
  add(a);
  add(b);
  return out;
}

function loadStatesObs(states, cb) {
  var products = [];
  var seen = {};
  var i;
  for (i = 0; i < states.length; i++) {
    var p = OBS_PRODUCTS[states[i]] || OBS_PRODUCTS.NSW;
    if (seen[p]) continue;
    seen[p] = true;
    products.push(p);
  }
  if (!products.length) return cb([]);
  var all = [];
  var left = products.length;
  products.forEach(function (p) {
    loadObsProduct(p, function (list) {
      all = mergeObsStations(all, list);
      left--;
      if (left <= 0) cb(all);
    });
  });
}

function fetchNearestObs(loc, cb) {
  var home = (loc && loc.s) || 'NSW';
  var product = OBS_PRODUCTS[home] || OBS_PRODUCTS.NSW;
  loadObsProduct(product, function (stations) {
    var obs = fillObsAt(loc.lat, loc.lon, stations);
    if (obs && obs.msl != null) return cb(null, obs);
    var neigh = OBS_NEIGHBOURS[home] || [];
    if (!neigh.length) return cb(null, obs);
    loadStatesObs(neigh, function (extra) {
      cb(null, fillObsAt(loc.lat, loc.lon, mergeObsStations(stations, extra)));
    });
  });
}

var obsStationCache = null;
var obsStationCacheAt = 0;

function pushObsStations(into, list, state) {
  if (!list || !into) return;
  for (var i = 0; i < list.length; i++) {
    var st = list[i];
    if (!hasCoords(st)) continue;
    into.push({
      name: st.name || 'Observation site',
      lat: st.lat,
      lon: st.lon,
      s: state,
      temp: st.temp,
      hum: st.hum,
      deltaT: st.deltaT,
      apparent: st.apparent,
      msl: st.msl,
      windDir: st.windDir,
      windKmh: st.windKmh,
      gust: st.gust,
      dew: st.dew,
      rain: st.rain
    });
  }
}

function listObsStations(cb) {
  if (obsStationCache && Date.now() - obsStationCacheAt < 1800000) {
    return cb(null, obsStationCache);
  }
  var products = [];
  var seen = {};
  Object.keys(OBS_PRODUCTS).forEach(function (st) {
    var p = OBS_PRODUCTS[st];
    if (seen[p]) return;
    seen[p] = true;
    products.push({ p: p, s: st });
  });
  var all = [];
  var left = products.length;
  if (!left) return cb(null, []);
  function done() {
    left--;
    if (left > 0) return;
    obsStationCache = all;
    obsStationCacheAt = Date.now();
    cb(null, all);
  }
  products.forEach(function (item) {
    loadObsProduct(item.p, function (stations) {
      pushObsStations(all, stations, item.s);
      done();
    });
  });
}

function nearestObsStationFromList(lat, lon, stations) {
  if (typeof lat !== 'number' || typeof lon !== 'number' ||
      !(lat || lon) || !stations || !stations.length) return null;
  var best = nearestFrom(stations, lat, lon);
  if (!best || !best.name) return null;
  return {
    name: best.name,
    km: Math.round(haversine(lat, lon, best.lat, best.lon))
  };
}

function formatObsStationLabel(st) {
  if (!st || !st.name) return 'None nearby';
  return st.name + ' \u00b7 ' + st.km + ' km';
}

function obsStationLabelForLoc(loc, stations) {
  if (!loc || !hasCoords(loc)) return 'Not detected yet';
  return formatObsStationLabel(nearestObsStationFromList(loc.lat, loc.lon, stations));
}

var WARN_FEEDS = {
  NSW: 'IDZ00054.warnings_nsw.xml',
  ACT: 'IDZ00054.warnings_nsw.xml',
  VIC: 'IDZ00059.warnings_vic.xml',
  QLD: 'IDZ00056.warnings_qld.xml',
  SA: 'IDZ00057.warnings_sa.xml',
  WA: 'IDZ00060.warnings_wa.xml',
  TAS: 'IDZ00058.warnings_tas.xml',
  NT: 'IDZ00055.warnings_nt.xml'
};

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
}

function rssTagText(block, tag) {
  var cdata = block.match(new RegExp('<' + tag + '[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>', 'i'));
  if (cdata) return cdata[1];
  var plain = block.match(new RegExp('<' + tag + '[^>]*>([^<]*)</' + tag + '>', 'i'));
  return plain ? plain[1] : '';
}

function rssHref(block, tag) {
  var href = block.match(new RegExp('<' + tag + '[^>]*href=["\\\']([^"\\\']+)["\\\']', 'i'));
  return href ? href[1] : '';
}

function parseWarningItems(xml) {
  var items = [];
  if (!xml) return items;
  var parts = xml.split('<item>');
  for (var i = 1; i < parts.length; i++) {
    var body = parts[i].split('</item>')[0];
    var title = rssTagText(body, 'title');
    var desc = rssTagText(body, 'description');
    var link = rssTagText(body, 'link') || rssHref(body, 'link') || rssTagText(body, 'guid');
    desc = stripTags(decodeXml(desc.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')));
    title = cleanWarnTitle(title);
    link = decodeXml(link).replace(/^\s+|\s+$/g, '');
    if (!title) continue;
    if (/cancel|finalising|no longer current|expired/i.test(title + ' ' + desc)) continue;
    items.push({ title: title, desc: desc, link: link });
  }
  return items;
}

function htmlToText(html) {
  var s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, ' ');
  return stripTags(decodeXml(s));
}

function sliceDivInner(html, start) {
  var i = html.indexOf('>', start) + 1;
  if (i < 1) return '';
  var depth = 1;
  var j = i;
  while (j < html.length && depth > 0) {
    var open = html.indexOf('<div', j);
    var close = html.indexOf('</div>', j);
    if (close < 0) {
      return html.slice(i, i + 20000);
    }
    if (open >= 0 && open < close) {
      depth++;
      j = open + 4;
    } else {
      depth--;
      if (depth === 0) {
        return html.slice(i, close);
      }
      j = close + 6;
    }
  }
  return html.slice(i, i + 20000);
}

function extractProductText(html) {
  var s = String(html || '').replace(/<img[\s\S]*?>/gi, ' ');
  var start = s.search(/<div[^>]*id="main"[^>]*>/i);
  if (start < 0) {
    start = s.search(/<div[^>]*class="[^"]*\bproduct\b[^"]*"/i);
  }
  if (start < 0) {
    start = s.search(/id="content"/i);
  }
  var chunk = start >= 0 ? sliceDivInner(s, start) : s;
  var text = pebbleSafe(htmlToText(chunk));
  text = text.replace(/^Warnings Information\b[\s\S]*?(?=ID[A-Z]{1,3}\d{5}\b|TOP PRIORITY|IMMEDIATE BROADCAST|Severe |Cancellation |Flood |Fire |Tsunami |Marine |Tropical )/i, '');
  text = text.replace(/^ID[A-Z]{1,3}\d{5}\s*/i, '');
  text = text.replace(/^Australian Government Bureau of Meteorology\s*/i, '');
  text = text.replace(/^TOP PRIORITY FOR IMMEDIATE BROADCAST\s*/i, '');
  text = text.replace(/^IMMEDIATE BROADCAST\s*/i, '');
  return text;
}

function warningPageUrls(link) {
  var raw = String(link || '').replace(/^\s+|\s+$/g, '');
  if (!raw) return [];
  if (raw.charAt(0) === '/') raw = 'https://www.bom.gov.au' + raw;
  var https = raw.replace(/^http:\/\//i, 'https://');
  var urls = [];
  function isBom(u) {
    return /^https:\/\/([\w-]+\.)?bom\.gov\.au\//i.test(u);
  }
  function add(u) {
    if (u && isBom(u) && urls.indexOf(u) < 0) urls.push(u);
  }
  add(https);
  add(https.replace('www.bom.gov.au', 'reg.bom.gov.au'));
  add(https.replace('reg.bom.gov.au', 'www.bom.gov.au'));
  var m = https.match(/wrap_fwo\.pl\?([A-Z0-9]+\.html)/i);
  if (m) {
    add('https://reg.bom.gov.au/fwo/' + m[1]);
    add('https://www.bom.gov.au/fwo/' + m[1]);
  }
  return urls;
}

function xhrUrlFallback(urls, cb) {
  var i = 0;
  function next() {
    if (i >= urls.length) {
      cb(new Error('network'));
      return;
    }
    xhrText(urls[i++], function (err, text) {
      if (err) next();
      else cb(null, text);
    });
  }
  next();
}

function fetchWarningPage(link, cb) {
  var urls = warningPageUrls(link);
  if (!urls.length) {
    cb(null, '');
    return;
  }
  xhrUrlFallback(urls, function (err, html) {
    if (err || !html) {
      cb(null, '');
      return;
    }
    cb(null, extractProductText(html));
  });
}

function isCoastalWarning(title, desc) {
  var t = ((title || '') + ' ' + (desc || '')).toLowerCase();
  return /marine|coastal waters|gale warning|storm force|hurricane force|tsunami|high tides?|hazardous surf|damaging surf|dangerous surf|coastal hazard|strong wind warning/.test(t);
}

function warningType(title, desc) {
  var t = ((title || '') + ' ' + (desc || '')).toLowerCase();
  if (/fire weather|bushfire|total fire ban|fire danger/.test(t)) return 'fire';
  if (/flood|river (height|level)|dam failure/.test(t)) return 'flood';
  if (isCoastalWarning(title, desc)) return 'marine';
  if (/thunder|severe weather|storm|cyclone|tornado/.test(t)) return 'storm';
  return 'other';
}

function warningMatches(item, loc, district) {
  var blob = ((item.title || '') + ' ' + (item.desc || '')).toLowerCase();
  var names = [];
  if (loc && loc.n) names.push(loc.n.toLowerCase());
  if (district) names.push(district.toLowerCase());
  if (loc && loc.s) {
    var stateNames = {
      NSW: 'new south wales', ACT: 'australian capital', VIC: 'victoria',
      QLD: 'queensland', SA: 'south australia', WA: 'western australia',
      TAS: 'tasmania', NT: 'northern territory'
    };
    if (stateNames[loc.s]) names.push(stateNames[loc.s]);
  }
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    if (n.length >= 3 && blob.indexOf(n) >= 0) return true;
  }
  return false;
}

function fetchTownWarnings(loc, forecastXml, includeCoastal, skipPages, cb) {
  if (typeof skipPages === 'function') {
    cb = skipPages;
    skipPages = false;
  }
  var feed = WARN_FEEDS[loc && loc.s] || WARN_FEEDS.NSW;
  var district = districtName(forecastXml, loc && loc.aac);
  xhrTextFallback(feed, function (err, xml) {
    if (err || !xml) return cb(null, []);
    var items = parseWarningItems(xml);
    var matched = [];
    var seen = {};
    var i;
    for (i = 0; i < items.length; i++) {
      if (!warningMatches(items[i], loc, district)) continue;
      var title = cleanWarnTitle(items[i].title);
      if (!includeCoastal && isCoastalWarning(title, items[i].desc)) continue;
      var type = warningType(title, items[i].desc);
      var key = type + '|' + title;
      if (seen[key]) continue;
      seen[key] = 1;
      matched.push({
        type: type,
        title: title,
        sub: district || loc.n || '',
        desc: items[i].desc || '',
        link: items[i].link || ''
      });
      if (matched.length >= 5) break;
    }
    if (!matched.length) {
      cb(null, []);
      return;
    }
    if (skipPages) {
      cb(null, matched.map(function (item) {
        return {
          type: item.type,
          title: item.title,
          sub: item.sub,
          body: '',
          link: item.link
        };
      }));
      return;
    }
    var left = matched.length;
    var out = new Array(matched.length);
    matched.forEach(function (item, idx) {
      fetchWarningPage(item.link, function (pageErr, text) {
        var body = pebbleSafe(text || item.desc || '');
        out[idx] = {
          type: item.type,
          title: item.title,
          sub: item.sub,
          body: body,
          link: item.link
        };
        left--;
        if (left === 0) cb(null, out);
      });
    });
  });
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function sunTimes(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return { rise: '', set: '' };
  var now = new Date();
  var tz = -now.getTimezoneOffset() / 60;
  var y = now.getFullYear();
  var m = now.getMonth() + 1;
  var day = now.getDate();
  function calc(rising) {
    var n1 = Math.floor(275 * m / 9) - Math.floor((m + 9) / 12) * (1 + Math.floor((y - 4 * Math.floor(y / 4) + 2) / 3)) + day - 30;
    var lngHour = lon / 15;
    var t = n1 + ((rising ? 6 : 18) - lngHour) / 24;
    var M = (0.9856 * t - 3.289) * Math.PI / 180;
    var L = M * 180 / Math.PI + 1.916 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 282.634;
    L = ((L % 360) + 360) % 360;
    var RA = Math.atan(0.91764 * Math.tan(L * Math.PI / 180)) * 180 / Math.PI;
    RA = ((RA % 360) + 360) % 360;
    var Lq = Math.floor(L / 90) * 90;
    var RAq = Math.floor(RA / 90) * 90;
    RA = RA + (Lq - RAq);
    RA = RA / 15;
    var sinDec = 0.39782 * Math.sin(L * Math.PI / 180);
    var cosDec = Math.cos(Math.asin(sinDec));
    var cosH = (Math.sin(-0.8333 * Math.PI / 180) - sinDec * Math.sin(lat * Math.PI / 180)) /
      (cosDec * Math.cos(lat * Math.PI / 180));
    if (cosH > 1 || cosH < -1) return '';
    var H = rising ? 360 - Math.acos(cosH) * 180 / Math.PI : Math.acos(cosH) * 180 / Math.PI;
    H = H / 15;
    var T = H + RA - (0.06571 * t) - 6.622;
    var UT = ((T - lngHour) % 24 + 24) % 24;
    var local = UT + tz;
    local = ((local % 24) + 24) % 24;
    var hr = Math.floor(local);
    var min = Math.round((local - hr) * 60);
    if (min === 60) { hr = (hr + 1) % 24; min = 0; }
    return pad2(hr) + ':' + pad2(min);
  }
  return { rise: calc(true), set: calc(false) };
}

var FIRE_PRODUCTS = {
  NSW: 'IDN10016',
  ACT: 'IDN10016',
  QLD: 'IDQ13016',
  TAS: 'IDT13151',
  WA: 'IDW12300',
  NT: 'IDD10731',
  VIC: 'IDV10490',
  SA: 'IDS10070'
};

function scoreFireMatch(desc, loc, district) {
  var hay = ((loc && loc.n) || '') + ' ' + (district || '');
  hay = hay.toLowerCase();
  var d = (desc || '').toLowerCase();
  if (!d) return 0;
  if (hay.indexOf(d) >= 0 || d.indexOf(((loc && loc.n) || '').toLowerCase()) >= 0) return 50 + d.length;
  var words = d.split(/[^a-z]+/);
  var score = 0;
  for (var i = 0; i < words.length; i++) {
    if (words[i].length > 3 && hay.indexOf(words[i]) >= 0) score += words[i].length;
  }
  return score;
}

function applyFireDanger(xml, loc, days) {
  if (!xml || !days || !days.length) return;
  var district = '';
  var parts = xml.split('<area ');
  var best = null;
  var bestScore = 0;
  var i;
  for (i = 1; i < parts.length; i++) {
    var head = parts[i].split('>')[0];
    if (head.indexOf('fire-district') < 0) continue;
    var desc = (head.match(/description="([^"]+)"/) || [])[1] || '';
    var sc = scoreFireMatch(desc, loc, district);
    if (sc > bestScore) {
      bestScore = sc;
      best = parts[i];
    }
  }
  if (!best) {
    for (i = 1; i < parts.length; i++) {
      if (parts[i].indexOf('type="fire-district"') >= 0) {
        best = parts[i];
        break;
      }
    }
  }
  if (!best) return;
  var fps = best.split('<forecast-period ');
  for (i = 1; i < fps.length && i <= days.length; i++) {
    var body = fps[i];
    var fd = body.match(/<text type="fire_danger">([^<]+)<\/text>/);
    if (fd && days[i - 1]) days[i - 1].fdr = decodeXml(fd[1]).replace(/\s+/g, ' ').trim();
  }
}

function fetchFireDanger(loc, days, cb) {
  var id = FIRE_PRODUCTS[loc && loc.s];
  if (!id) return cb();
  xhrTextFallback(id + '.xml', function (err, xml) {
    if (!err && xml) applyFireDanger(xml, loc, days);
    cb();
  });
}

function parseCoastPeriods(inner) {
  if (!inner) return [];
  var periods = [];
  var parts = inner.split('<forecast-period ');
  for (var i = 1; i < parts.length; i++) {
    var p = parts[i];
    var end = p.indexOf('</forecast-period>');
    if (end < 0) continue;
    var body = p.slice(0, end);
    function tx(type) {
      var rx = new RegExp('<text type="' + type + '">([^<]*)</text>');
      var mm = body.match(rx);
      return mm ? decodeXml(mm[1]).replace(/\s+/g, ' ').trim() : '';
    }
    var idx = body.match(/index="(\d+)"/);
    var start = body.match(/start-time-local="([^"]+)"/);
    periods.push({
      index: idx ? +idx[1] : periods.length,
      start: start ? start[1] : '',
      winds: tx('forecast_winds'),
      seas: tx('forecast_seas'),
      swell1: tx('forecast_swell1'),
      swell2: tx('forecast_swell2'),
      weather: tx('forecast_weather'),
      waves: tx('forecast_waves'),
      surf: tx('forecast_surf') || tx('surf'),
      caution: tx('forecast_caution'),
      marine: tx('marine_forecast')
    });
  }
  return periods;
}

function formatCoastal(zoneName, p) {
  if (!p) return '';
  var parts = [];
  if (zoneName) parts.push(zoneName);
  function add(label, val) {
    val = String(val || '').replace(/\s+/g, ' ').trim();
    if (!val) return;
    if (!/\.$/.test(val)) val += '.';
    parts.push(label + ' ' + val);
  }
  add('Seas', p.seas);
  add('Swell', p.swell1);
  add('Swell 2', p.swell2);
  add('Wind', p.winds);
  add('Weather', p.weather);
  add('Waves', p.waves);
  add('Surf', p.surf);
  add('Caution', p.caution);
  if (!p.seas && !p.swell1 && p.marine) add('Marine', p.marine);
  return parts.join('\n');
}

function nearestCoast(loc) {
  var state = loc.s === 'ACT' ? 'NSW' : loc.s;
  var list = [];
  for (var i = 0; i < coasts.length; i++) {
    if (coasts[i].s === state) list.push(coasts[i]);
  }
  if (!list.length) return null;
  return nearestFrom(list, loc.lat, loc.lon);
}

function fetchCoastal(loc, days, cb) {
  var product = COAST_PRODUCTS[loc.s] || COAST_PRODUCTS.NSW;
  var zone = nearestCoast(loc);
  if (!zone) return cb();
  xhrTextFallback(product + '.xml', function (err, xml) {
    if (err || !xml) return cb();
    var inner = innerByAac(xml, zone.aac);
    var periods = parseCoastPeriods(inner);
    if (!periods.length) return cb();
    for (var i = 0; i < days.length; i++) {
      var extra = extraForDay(days[i], i, periods);
      if (!extra) continue;
      days[i].coastal = formatCoastal(zone.n, extra);
      days[i].coastName = zone.n;
    }
    cb();
  });
}

function fetchForecast(loc, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }
  opts = opts || {};
  xhrTextFallback(loc.p + '.xml', function (err, xml) {
    if (err) return cb(err);
    var inner = innerByAac(xml, loc.aac);
    if (!inner) inner = innerByDescription(xml, loc.n, 'location');
    var days = toDays(parsePeriods(inner), loc.s);
    if (!days.length) return cb(new Error('no periods'));

    function finish(finalDays) {
      var pending = 3;
      var extras = { obs: null, warnings: [] };
      if (opts.coastal) pending++;
      function one() {
        pending--;
        if (pending > 0) return;
        var sun = sunTimes(loc.lat, loc.lon);
        cb(null, {
          location: loc.n,
          state: loc.s,
          lat: loc.lat,
          lon: loc.lon,
          radar: nearestRadar(loc.lat, loc.lon),
          days: finalDays,
          obs: extras.obs,
          warnings: extras.warnings,
          warning: extras.warnings[0] || null,
          fdr: (finalDays[0] && finalDays[0].fdr) || '',
          sunrise: sun.rise,
          sunset: sun.set
        });
      }
      fetchNearestObs(loc, function (oErr, obs) {
        extras.obs = obs || null;
        one();
      });
      fetchTownWarnings(loc, xml, !!opts.coastal, !!opts.skipWarningPages, function (wErr, warnings) {
        extras.warnings = warnings || [];
        one();
      });
      fetchFireDanger(loc, finalDays, function () {
        one();
      });
      if (opts.coastal) {
        fetchCoastal(loc, finalDays, function () {
          one();
        });
      }
    }

    var extraIds = [];
    if (loc.c) extraIds.push(loc.c);
    var uvId = UV_BY_STATE[loc.s];
    if (uvId && extraIds.indexOf(uvId) < 0) extraIds.push(uvId);
    if (!extraIds.length) return finish(days);

    function applyCityXml(cityXml, daysSoFar) {
      var locInner = innerByAac(cityXml, loc.aac) ||
        innerByDescription(cityXml, loc.n, 'location') ||
        innerByDescription(cityXml, loc.n, 'metropolitan');
      daysSoFar = mergeExtended(daysSoFar, parsePeriods(locInner));
      return mergeExtended(daysSoFar, uvPeriodsForLoc(cityXml, xml, loc));
    }

    function fetchExtra(i, daysSoFar) {
      if (i >= extraIds.length) return finish(daysSoFar);
      xhrTextFallback(extraIds[i] + '.xml', function (cityErr, cityXml) {
        if (!cityErr && cityXml) {
          daysSoFar = applyCityXml(cityXml, daysSoFar);
        }
        if (daysSoFar[0] && daysSoFar[0].uv && i + 1 < extraIds.length) {
          return finish(daysSoFar);
        }
        fetchExtra(i + 1, daysSoFar);
      });
    }
    fetchExtra(0, days);
  });
}

module.exports = {
  findTown: findTown,
  findPostcode: findPostcode,
  nearestTown: nearestTown,
  nearestTowns: nearestTowns,
  nearestRadar: nearestRadar,
  resolveQuery: resolveQuery,
  getTowns: getTowns,
  loadSavedTowns: loadSavedTowns,
  fetchTownList: fetchTownList,
  fetchForecast: fetchForecast,
  pebbleSafe: pebbleSafe,
  cleanWarnTitle: cleanWarnTitle,
  warningPageUrls: warningPageUrls,
  fetchWarningPage: fetchWarningPage,
  listObsStations: listObsStations,
  obsStationLabelForLoc: obsStationLabelForLoc,
  fillObsAt: fillObsAt,
  obsFillNotes: obsFillNotes,
  obsCalcMask: obsCalcMask,
  obsPageHelpersSource: obsPageHelpersSource
};
