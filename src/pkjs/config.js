function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toUrl(settings, extras) {
  settings = settings || {};
  extras = extras || {};
  var mode = settings.LocationMode === 'manual' ? 'manual' : 'auto';
  var town = settings.TownName || '';
  var autoNow = extras.autoLocation || 'Not detected yet';
  var autoObs = extras.autoObs || 'Not detected yet';
  var manualObs = extras.manualObs || '—';
  var locLine = 'Auto currently: ' + autoNow;
  var autoLat = extras.autoLat;
  var autoLon = extras.autoLon;
  var refreshStatus = extras.refreshStatus || ((extras.townCount || 0) + ' towns');
  var range = String(settings.RadarRange == null ? '128' : settings.RadarRange);
  if (['64', '128', '256', '512', 'state', 'national'].indexOf(range) === -1) range = '128';
  var theme = (settings.Theme === 'light' || settings.Theme === 1 || settings.Theme === '1') ? 'light' : 'dark';
  function rangeOpt(v, label) {
    return '<option value="' + v + '"' + (range === String(v) ? ' selected' : '') + '>' + label + '</option>';
  }
  function ovOn(key, fallback) {
    if (settings[key] === undefined || settings[key] === null || settings[key] === '') return fallback;
    return settings[key] === true || settings[key] === 1 || settings[key] === '1';
  }
  function chk(id, label, on) {
    return '<label class="chk"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '> ' + label + '</label>';
  }
  var blobJs = JSON.stringify(extras.townsBlob || '');
  var pcJs = JSON.stringify(extras.postcodesBlob || '');
  var obsJs = JSON.stringify(extras.obsBlob || '');
  var helpers = extras.obsHelpers || '';

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>BOM Weather</title>' +
    '<style>' +
    'body{font-family:sans-serif;background:#333;color:#fff;margin:0;padding:16px}' +
    'h1{font-size:22px;margin:8px 0 12px}' +
    'label{display:block;margin:14px 0 6px;color:#ccc}' +
    'select,input{width:100%;box-sizing:border-box;padding:10px;font-size:16px;border:0;border-radius:4px}' +
    'input:disabled{background:#555;color:#999}' +
    'p{color:#aaa;font-size:14px;line-height:1.4;margin:8px 0}' +
    '.auto{background:#2a2a2a;padding:10px;border-radius:4px;color:#fff}' +
    '.auto.sub{margin-top:6px;padding:8px 10px;font-size:13px;color:#bbb;white-space:pre-line}' +
    '.row{display:flex;align-items:center;gap:12px;margin:0 0 8px}' +
    '.chk{display:block;margin:8px 0;color:#fff;font-size:16px}' +
    '.chk input{width:auto;margin-right:8px}' +
    '#refresh{width:auto;margin:0;padding:10px 14px;font-size:15px}' +
    '#refreshStatus{color:#ccc;font-size:14px;line-height:1.3}' +
    '#matches{background:#222;border-radius:4px;margin-top:6px;max-height:240px;overflow:auto}' +
    '#matches div{padding:10px;border-bottom:1px solid #444}' +
    '#matches .hint{color:#888;font-size:13px}' +
    'button{margin-top:20px;width:100%;padding:12px;font-size:18px;background:#ff4700;color:#fff;border:0;border-radius:4px}' +
    '</style></head><body>' +
    '<h1>BOM Weather</h1>' +
    '<label for="theme">Watch theme</label>' +
    '<select id="theme">' +
    '<option value="dark"' + (theme === 'dark' ? ' selected' : '') + '>Dark</option>' +
    '<option value="light"' + (theme === 'light' ? ' selected' : '') + '>Light</option>' +
    '</select>' +
    '<p>Applies to the watch app menus, day cards and warnings.</p>' +
    '<div class="row">' +
    '<button type="button" id="refresh">Refresh towns</button>' +
    '<span id="refreshStatus">' + escapeHtml(refreshStatus) + '</span>' +
    '</div>' +
    '<p>Clicking Refresh towns will cause this settings page to close in order to save the update data.</p>' +
    '<label for="mode">Location mode</label>' +
    '<select id="mode">' +
    '<option value="auto"' + (mode === 'auto' ? ' selected' : '') + '>Auto (phone GPS)</option>' +
    '<option value="manual"' + (mode === 'manual' ? ' selected' : '') + '>Manual town</option>' +
    '</select>' +
    '<p class="auto" id="locNow"' + (mode === 'manual' ? ' style="display:none"' : '') + '>' + escapeHtml(locLine) + '</p>' +
    '<p class="auto sub" id="autoObs"' + (mode === 'manual' ? ' style="display:none"' : '') + '>Obs station: ' + escapeHtml(autoObs) + '</p>' +
    '<label for="town">Town, suburb or postcode</label>' +
    '<input id="town" value="' + escapeHtml(town) + '" placeholder="e.g. Newcastle or 2300" autocomplete="off">' +
    '<p class="auto sub" id="manualObs"' + (mode === 'auto' ? ' style="display:none"' : '') + '>Obs station: ' + escapeHtml(manualObs) + '</p>' +
    '<div id="matches"></div>' +
    '<p>Pick a BOM forecast town. Enter a postcode to see the 3 nearest supported towns.</p>' +
    '<label>Pages</label>' +
    chk('coastal', 'Coastal details', ovOn('CoastalDetails', false)) +
    '<p>Adds a seas, swell and wind page on Current and each day, using the nearest BOM coastal waters forecast. Also includes marine and coastal warnings such as wind, surf, tsunami and coastal hazard.</p>' +
    (extras.showRadar === false ? '<div style="display:none">' : '') +
    '<label for="radar">Default radar range</label>' +
    '<select id="radar">' +
    rangeOpt(64, '64 km') +
    rangeOpt(128, '128 km') +
    rangeOpt(256, '256 km') +
    rangeOpt(512, '512 km') +
    rangeOpt('state', 'State') +
    rangeOpt('national', 'National') +
    '</select>' +
    '<p>Used when you open rain radar. Change range on the watch with up and down.</p>' +
    '<label>Radar overlays</label>' +
    chk('ovCrosshair', 'Town crosshair', ovOn('RadarOvCrosshair', true)) +
    chk('ovLocations', 'Locations', ovOn('RadarOvLocations', true)) +
    chk('ovCatchments', 'Catchments', ovOn('RadarOvCatchments', true)) +
    chk('ovRail', 'Rail', ovOn('RadarOvRail', true)) +
    chk('ovRange', 'Range', ovOn('RadarOvRange', true)) +
    chk('ovRoads', 'Roads', ovOn('RadarOvRoads', true)) +
    chk('ovTopography', 'Topography', ovOn('RadarOvTopography', true)) +
    chk('ovWaterways', 'Waterways', ovOn('RadarOvWaterways', true)) +
    (extras.showRadar === false ? '</div>' : '') +
    '<button id="save">Save</button>' +
    '<script>' +
    'var raw=' + blobJs + ';' +
    'var pcraw=' + pcJs + ';' +
    'var obsraw=' + obsJs + ';' +
    'var towns=[];var postcodes=[];var obsList=[];' +
    'raw.split("\\n").forEach(function(line){' +
    'var p=line.split("\\t");' +
    'if(p[0])towns.push({n:p[0],s:p[1]||"",lat:+p[2]||0,lon:+p[3]||0});' +
    '});' +
    'pcraw.split("\\n").forEach(function(line){' +
    'var p=line.split("\\t");' +
    'if(p[0])postcodes.push({pc:p[0],lat:+p[1],lon:+p[2]});' +
    '});' +
    '\n' + helpers + '\n' +
    'obsraw.split("\\n").forEach(function(line){' +
    'var p=line.split("\\t");' +
    'if(!p[0])return;' +
    'obsList.push({name:p[0],lat:+p[1],lon:+p[2],' +
    'temp:numOrNull(p[3]),hum:numOrNull(p[4]),deltaT:numOrNull(p[5]),' +
    'apparent:numOrNull(p[6]),msl:numOrNull(p[7]),windKmh:numOrNull(p[8]),dew:numOrNull(p[9])});' +
    '});' +
    'var autoTown=' + JSON.stringify(autoNow) + ';' +
    'var autoLat=' + (autoLat == null || autoLat === '' ? 'null' : Number(autoLat)) + ';' +
    'var autoLon=' + (autoLon == null || autoLon === '' ? 'null' : Number(autoLon)) + ';' +
    'var savedTown=' + JSON.stringify(town) + ';' +
    'var locNowEl=document.getElementById("locNow");' +
    'var autoObsEl=document.getElementById("autoObs");' +
    'var input=document.getElementById("town");' +
    'var list=document.getElementById("matches");' +
    'var manualObsEl=document.getElementById("manualObs");' +
    'function labelOf(t){return t.s?t.n+", "+t.s:t.n;}' +
    'function townByLabel(lab){' +
    'if(!lab)return null;' +
    'var ql=lab.toLowerCase();' +
    'var hits=[];' +
    'for(var i=0;i<towns.length;i++){' +
    'var t=towns[i];var l=labelOf(t).toLowerCase();' +
    'if(l===ql||t.n.toLowerCase()===ql)hits.push(t);' +
    '}' +
    'return hits.length===1?hits[0]:null;' +
    '}' +
    'function obsFor(lat,lon){' +
    'if(!lat&&!lon)return "—";' +
    'var best=null,bd=1e9;' +
    'for(var i=0;i<obsList.length;i++){' +
    'var d=dist(lat,lon,obsList[i].lat,obsList[i].lon);' +
    'if(d<bd){bd=d;best=obsList[i];}' +
    '}' +
    'return best?best.name+" · "+Math.round(bd)+" km":"None nearby";' +
    '}' +
    'function setObs(el,lat,lon){' +
    'if(!el)return;' +
    'var line="Obs station: "+obsFor(lat,lon);' +
    'if((lat||lon)&&typeof fillObsAt==="function"){' +
    'var filled=fillObsAt(lat,lon,obsList);' +
    'var notes=typeof obsFillNotes==="function"?obsFillNotes(filled):[];' +
    'if(notes&&notes.length)line+="\\n"+notes.join("\\n");' +
    '}' +
    'el.textContent=line;' +
    '}' +
    'function setManualObs(lat,lon){' +
    'setObs(manualObsEl,lat,lon);' +
    '}' +
    'function townUnchanged(){' +
    'return input.value.trim()===savedTown;' +
    '}' +
    'function hideMatches(){' +
    'list.innerHTML="";' +
    'list.style.display="none";' +
    '}' +
    'function selectedTown(){' +
    'var q=input.value.trim();' +
    'if(!q)return null;' +
    'if(/^\\d{4}$/.test(q)){' +
    'for(var i=0;i<postcodes.length;i++){if(postcodes[i].pc===q)return postcodes[i];}' +
    'return null;' +
    '}' +
    'return townByLabel(q);' +
    '}' +
    'function syncLocLine(){' +
    'var auto=modeEl.value==="auto";' +
    'locNowEl.style.display=auto?"":"none";' +
    'autoObsEl.style.display=auto?"":"none";' +
    'manualObsEl.style.display=auto?"none":"";' +
    'if(auto){locNowEl.textContent="Auto currently: "+autoTown;setObs(autoObsEl,autoLat,autoLon);}' +
    '}' +
    'function dist(a,b,c,d){var r=6371,x=(c-a)*Math.PI/180,y=(d-b)*Math.PI/180;' +
    'var e=Math.sin(x/2)*Math.sin(x/2)+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(y/2)*Math.sin(y/2);' +
    'return r*2*Math.atan2(Math.sqrt(e),Math.sqrt(1-e));}' +
    'function nearest3(lat,lon){' +
    'var s=[];' +
    'for(var i=0;i<towns.length;i++){' +
    'if(!towns[i].lat&&!towns[i].lon)continue;' +
    's.push({t:towns[i],d:dist(lat,lon,towns[i].lat,towns[i].lon)});' +
    '}' +
    's.sort(function(a,b){return a.d-b.d;});' +
    'return s.slice(0,3);' +
    '}' +
    'function add(text,value,cls){' +
    'var d=document.createElement("div");' +
    'if(cls)d.className=cls;' +
    'd.textContent=text;' +
    'if(value)d.onclick=function(){input.value=value;hideMatches();var t=townByLabel(value);if(t)setManualObs(t.lat,t.lon);};' +
    'list.appendChild(d);' +
    '}' +
    'function showNearest(lat,lon,title){' +
    'add(title,"","hint");' +
    'nearest3(lat,lon).forEach(function(x){' +
    'var lab=labelOf(x.t);' +
    'add(lab+" · "+Math.round(x.d)+" km",lab);' +
    '});' +
    '}' +
    'function refreshObs(){' +
    'var q=input.value.trim();' +
    'if(!q){setManualObs(0,0);return;}' +
    'if(/^\\d{4}$/.test(q)){' +
    'var pc=null;' +
    'for(var i=0;i<postcodes.length;i++){if(postcodes[i].pc===q){pc=postcodes[i];break;}}' +
    'if(pc)setManualObs(pc.lat,pc.lon);else setManualObs(0,0);' +
    'return;' +
    '}' +
    'var exact=townByLabel(q);' +
    'if(exact)setManualObs(exact.lat,exact.lon);' +
    'else setManualObs(0,0);' +
    '}' +
    'function fillMatches(){' +
    'list.innerHTML="";' +
    'if(modeEl.value==="auto"||townUnchanged()){hideMatches();return;}' +
    'var q=input.value.trim();' +
    'if(!q){hideMatches();return;}' +
    'list.style.display="block";' +
    'if(/^\\d{4}$/.test(q)){' +
    'var pc=null;' +
    'for(var i=0;i<postcodes.length;i++){if(postcodes[i].pc===q){pc=postcodes[i];break;}}' +
    'if(!pc){add("Postcode not found","","hint");return;}' +
    'showNearest(pc.lat,pc.lon,"Nearest BOM towns to "+q);' +
    'return;' +
    '}' +
    'var ql=q.toLowerCase();var n=0;' +
    'for(var j=0;j<towns.length&&n<20;j++){' +
    'var lab=labelOf(towns[j]);' +
    'if(lab.toLowerCase().indexOf(ql)===-1)continue;' +
    'add(lab,lab);n++;' +
    '}' +
    'if(!n)add("No exact town. Type a postcode for the 3 nearest, or Save to snap to nearest.","","hint");' +
    '}' +
    'function onTownInput(){refreshObs();fillMatches();}' +
    'input.addEventListener("input",onTownInput);' +
    'var modeEl=document.getElementById("mode");' +
    'function syncTown(){' +
    'var auto=modeEl.value==="auto";' +
    'input.disabled=auto;' +
    'if(auto)hideMatches();' +
    'else {refreshObs();fillMatches();}' +
    'syncLocLine();' +
    '}' +
    'modeEl.addEventListener("change",syncTown);' +
    'syncTown();' +
    'function payload(extra){' +
    'var radarEl=document.getElementById("radar");' +
    'var data={LocationMode:document.getElementById("mode").value,TownName:input.value,' +
    'CoastalDetails:document.getElementById("coastal").checked?1:0,' +
    'Theme:document.getElementById("theme").value,' +
    'RadarRange:radarEl.value,' +
    'RadarOvCrosshair:document.getElementById("ovCrosshair").checked?1:0,' +
    'RadarOvLocations:document.getElementById("ovLocations").checked?1:0,' +
    'RadarOvCatchments:document.getElementById("ovCatchments").checked?1:0,' +
    'RadarOvRail:document.getElementById("ovRail").checked?1:0,' +
    'RadarOvRange:document.getElementById("ovRange").checked?1:0,' +
    'RadarOvRoads:document.getElementById("ovRoads").checked?1:0,' +
    'RadarOvTopography:document.getElementById("ovTopography").checked?1:0,' +
    'RadarOvWaterways:document.getElementById("ovWaterways").checked?1:0};' +
    'if(extra)for(var k in extra)data[k]=extra[k];' +
    'document.location="pebblejs://close#"+encodeURIComponent(JSON.stringify(data));' +
    '}' +
    'document.getElementById("refresh").onclick=function(){' +
    'document.getElementById("refreshStatus").textContent="Refreshing...";' +
    'payload({action:"refreshTowns"});' +
    '};' +
    'document.getElementById("save").onclick=function(){payload();};' +
    '</script></body></html>';
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

module.exports = {
  toUrl: toUrl
};
