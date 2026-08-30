#include "weather.h"
#include <string.h>
#include <stdlib.h>

WeatherState g_weather;

static void apply_status(int status);

static void copy_tuple_str(char *dest, size_t dest_size, Tuple *t) {
  if (!t || t->type != TUPLE_CSTRING) {
    return;
  }
  if (dest_size <= 1) {
    if (dest && dest_size) dest[0] = '\0';
    return;
  }
  strncpy(dest, t->value->cstring, dest_size - 1);
  dest[dest_size - 1] = '\0';
}

static int32_t tuple_int(Tuple *t, int32_t fallback) {
  if (!t) {
    return fallback;
  }
  if (t->type == TUPLE_CSTRING) {
    return atoi(t->value->cstring);
  }
  if (t->length == 1) {
    return (int32_t)t->value->uint8;
  }
  if (t->length == 2) {
    return (int32_t)t->value->int16;
  }
  return t->value->int32;
}

static void copy_str(char *dst, size_t dst_size, const char *src) {
  if (!dst || dst_size == 0) {
    return;
  }
  if (!src || dst_size == 1) {
    dst[0] = '\0';
    return;
  }
  strncpy(dst, src, dst_size - 1);
  dst[dst_size - 1] = '\0';
}

static void copy_span(char *dst, size_t dst_size, const char *src, size_t len) {
  if (!dst || dst_size == 0) {
    return;
  }
  if (len >= dst_size) {
    len = dst_size - 1;
  }
  memcpy(dst, src, len);
  dst[len] = '\0';
}

static int span_int(const char *src, size_t len) {
  char tmp[12];
  copy_span(tmp, sizeof(tmp), src, len);
  return atoi(tmp);
}

static int parse_tenths(const char *s) {
  if (!s || !s[0]) {
    return 0;
  }
  int neg = s[0] == '-';
  int whole = atoi(s);
  const char *dot = strchr(s, '.');
  int tenth = 0;
  if (dot && dot[1] >= '0' && dot[1] <= '9') {
    tenth = dot[1] - '0';
  }
  if (neg) {
    if (whole < 0) {
      return whole * 10 - tenth;
    }
    return -tenth;
  }
  return whole * 10 + tenth;
}

static void apply_packed_days(const char *packed) {
  if (!packed || !packed[0]) {
    return;
  }
  g_weather.day_count = 0;
  const char *line = packed;
  while (*line && g_weather.day_count < MAX_DAYS) {
    const char *line_end = line;
    while (*line_end && *line_end != '\n') {
      line_end++;
    }
    if (line_end > line) {
      DayForecast *d = &g_weather.days[g_weather.day_count];
      memset(d, 0, sizeof(*d));
      d->min = TEMP_NONE;
      d->max = TEMP_NONE;
      d->rain_chance = -1;

      const char *field = line;
      int fi = 0;
      while (field <= line_end && fi < 10) {
        const char *tab = field;
        while (tab < line_end && *tab != '\t') {
          tab++;
        }
        size_t flen = (size_t)(tab - field);
        switch (fi) {
          case 0:
            copy_span(d->name, sizeof(d->name), field, flen);
            break;
          case 1:
            d->min = span_int(field, flen);
            break;
          case 2:
            d->max = span_int(field, flen);
            break;
          case 3:
            copy_span(d->precis, sizeof(d->precis), field, flen);
            break;
          case 4:
            d->rain_chance = span_int(field, flen);
            break;
          case 5:
            copy_span(d->rain_amount, sizeof(d->rain_amount), field, flen);
            break;
          case 6:
            d->icon = span_int(field, flen);
            break;
          case 7:
            copy_span(d->title, sizeof(d->title), field, flen);
            break;
          case 8:
            copy_span(d->uv, sizeof(d->uv), field, flen);
            break;
          case 9:
            copy_span(d->fdr, sizeof(d->fdr), field, flen);
            break;
          default:
            break;
        }
        fi++;
        if (tab >= line_end) {
          break;
        }
        field = tab + 1;
      }
      if (!d->title[0] && d->name[0]) {
        copy_str(d->title, sizeof(d->title), d->name);
      }
      g_weather.day_count++;
    }
    line = *line_end ? line_end + 1 : line_end;
  }
#if defined(PBL_PLATFORM_APLITE)
  g_weather.view_extended[0] = '\0';
  g_weather.view_coastal[0] = '\0';
  g_weather.coastal_now[0] = '\0';
  g_weather.view_detail_index = -1;
#endif
}

static int warn_type_from_name(const char *name) {
  if (!name) {
    return WARN_OTHER;
  }
  if (strcmp(name, "fire") == 0) return WARN_FIRE;
  if (strcmp(name, "flood") == 0) return WARN_FLOOD;
  if (strcmp(name, "storm") == 0) return WARN_STORM;
  if (strcmp(name, "marine") == 0) return WARN_MARINE;
  return WARN_OTHER;
}

static void clear_warnings(void) {
  g_weather.warn_count = 0;
  g_weather.has_warn = 0;
  g_weather.warn_title[0] = '\0';
  g_weather.warn_sub[0] = '\0';
  g_weather.warn_full[0] = '\0';
  memset(g_weather.warnings, 0, sizeof(g_weather.warnings));
}

static void apply_warn_packed(const char *packed) {
  clear_warnings();
  if (!packed || !packed[0]) {
    return;
  }
  const char *p = packed;
  while (*p && g_weather.warn_count < MAX_WARNINGS) {
    const char *line_end = p;
    while (*line_end && *line_end != '\n') {
      line_end++;
    }
    const char *tab1 = NULL;
    const char *tab2 = NULL;
    const char *c;
    for (c = p; c < line_end; c++) {
      if (*c == '\t') {
        if (!tab1) {
          tab1 = c;
        } else if (!tab2) {
          tab2 = c;
          break;
        }
      }
    }
    WarningItem *w = &g_weather.warnings[g_weather.warn_count];
    if (tab1) {
      char name[12];
      copy_span(name, sizeof(name), p, (size_t)(tab1 - p));
      w->type = warn_type_from_name(name);
      if (tab2) {
        copy_span(w->title, sizeof(w->title), tab1 + 1, (size_t)(tab2 - tab1 - 1));
        copy_span(w->body, sizeof(w->body), tab2 + 1, (size_t)(line_end - tab2 - 1));
      } else {
        copy_span(w->title, sizeof(w->title), tab1 + 1, (size_t)(line_end - tab1 - 1));
      }
    } else {
      w->type = WARN_OTHER;
      copy_span(w->title, sizeof(w->title), p, (size_t)(line_end - p));
    }
    g_weather.warn_count++;
    p = *line_end ? line_end + 1 : line_end;
  }
  g_weather.has_warn = g_weather.warn_count > 0;
  if (g_weather.warn_count == 1) {
    copy_str(g_weather.warn_title, sizeof(g_weather.warn_title), g_weather.warnings[0].title);
    if (!g_weather.warn_sub[0] && g_weather.warnings[0].body[0]) {
      copy_str(g_weather.warn_sub, sizeof(g_weather.warn_sub), g_weather.warnings[0].body);
    }
  } else if (g_weather.warn_count > 1) {
    copy_str(g_weather.warn_title, sizeof(g_weather.warn_title), "Warnings");
    snprintf(g_weather.warn_sub, sizeof(g_weather.warn_sub), "%d current", g_weather.warn_count);
  }
}

#define PKEY_LOC 1
#define PKEY_DAYS 2
#define PKEY_META 3
#define PKEY_TENTHS 4

typedef struct {
  char name[MAX_DAY_NAME];
  char title[MAX_DAY_TITLE];
  char precis[MAX_PRECIS];
  int16_t min;
  int16_t max;
  int16_t rain_chance;
  int16_t icon;
  char uv[MAX_UV];
  char fdr[MAX_FDR];
} PersistDay;

static void persist_save(void) {
  if (!g_weather.day_count || !g_weather.location[0]) {
    return;
  }
  persist_write_string(PKEY_LOC, g_weather.location);
  persist_write_int(PKEY_META, g_weather.day_count);
  persist_write_int(PKEY_TENTHS, 1);
  for (int i = 0; i < g_weather.day_count && i < MAX_DAYS; i++) {
    PersistDay p;
    memset(&p, 0, sizeof(p));
    copy_str(p.name, sizeof(p.name), g_weather.days[i].name);
    copy_str(p.title, sizeof(p.title), g_weather.days[i].title);
    copy_str(p.precis, sizeof(p.precis), g_weather.days[i].precis);
    p.min = (int16_t)g_weather.days[i].min;
    p.max = (int16_t)g_weather.days[i].max;
    p.rain_chance = (int16_t)g_weather.days[i].rain_chance;
    p.icon = (int16_t)g_weather.days[i].icon;
    copy_str(p.uv, sizeof(p.uv), g_weather.days[i].uv);
    copy_str(p.fdr, sizeof(p.fdr), g_weather.days[i].fdr);
    persist_write_data(10 + i, &p, sizeof(p));
  }
}

static bool persist_load(void) {
  if (!persist_exists(PKEY_LOC) || !persist_exists(PKEY_META)) {
    return false;
  }
  persist_read_string(PKEY_LOC, g_weather.location, sizeof(g_weather.location));
  g_weather.day_count = persist_read_int(PKEY_META);
  if (g_weather.day_count < 1 || g_weather.day_count > MAX_DAYS) {
    g_weather.day_count = 0;
    return false;
  }
  for (int i = 0; i < g_weather.day_count; i++) {
    PersistDay p;
    memset(&p, 0, sizeof(p));
    if (persist_read_data(10 + i, &p, sizeof(p)) <= 0) {
      g_weather.day_count = i;
      break;
    }
    DayForecast *d = &g_weather.days[i];
    memset(d, 0, sizeof(*d));
    copy_str(d->name, sizeof(d->name), p.name);
    copy_str(d->title, sizeof(d->title), p.title);
    copy_str(d->precis, sizeof(d->precis), p.precis);
    d->min = p.min;
    d->max = p.max;
    if (!persist_exists(PKEY_TENTHS)) {
      d->min = (p.min == 99) ? TEMP_NONE : (int)p.min * 10;
      d->max = (p.max == 99) ? TEMP_NONE : (int)p.max * 10;
    }
    d->rain_chance = p.rain_chance;
    d->icon = p.icon;
    copy_str(d->uv, sizeof(d->uv), p.uv);
    copy_str(d->fdr, sizeof(d->fdr), p.fdr);
  }
  if (g_weather.days[0].fdr[0]) {
    copy_str(g_weather.fdr, sizeof(g_weather.fdr), g_weather.days[0].fdr);
  }
  return g_weather.day_count > 0;
}

static void cache_timeout(void *data) {
  (void)data;
  if (g_weather.status == STATUS_LOADING && g_weather.day_count > 0) {
    g_weather.cached = 1;
    apply_status(STATUS_OK);
    forecast_menu_toast("Using cached data");
    forecast_menu_reload();
    day_detail_reload();
  }
}

void weather_request(int request_type, int extra) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    return;
  }
  dict_write_int32(iter, MESSAGE_KEY_RequestType, request_type);
  dict_write_int32(iter, MESSAGE_KEY_DetailIndex, extra);
  int dw = 144;
  int dh = 168;
  Window *top = window_stack_get_top_window();
  if (top) {
    GRect bounds = layer_get_bounds(window_get_root_layer(top));
    dw = bounds.size.w;
    dh = bounds.size.h;
  }
  dict_write_int32(iter, MESSAGE_KEY_DisplayW, dw);
  dict_write_int32(iter, MESSAGE_KEY_DisplayH, dh);
  app_message_outbox_send();
}

static void apply_status(int status) {
  g_weather.status = status;
  switch (status) {
    case STATUS_OK:
      g_weather.status_text[0] = '\0';
      break;
    case STATUS_LOADING:
      snprintf(g_weather.status_text, sizeof(g_weather.status_text), "Waiting for phone...");
      break;
    case STATUS_LOCATION:
      snprintf(g_weather.status_text, sizeof(g_weather.status_text), "Set town in settings");
      break;
    case STATUS_NOT_FOUND:
      snprintf(g_weather.status_text, sizeof(g_weather.status_text), "Town not found");
      break;
    default:
      snprintf(g_weather.status_text, sizeof(g_weather.status_text), "BOM unavailable");
      break;
  }
}

static void inbox_received(DictionaryIterator *iter, void *context) {
  (void)context;
#if HAS_RADAR
  Tuple *radar_total = dict_find(iter, MESSAGE_KEY_RadarTotalSize);
  Tuple *radar_chunk = dict_find(iter, MESSAGE_KEY_RadarChunk);
  Tuple *radar_done = dict_find(iter, MESSAGE_KEY_RadarComplete);
  Tuple *radar_notice = dict_find(iter, MESSAGE_KEY_RadarNotice);
  Tuple *radar_count = dict_find(iter, MESSAGE_KEY_RadarFrameCount);
  Tuple *radar_range = dict_find(iter, MESSAGE_KEY_RadarRange);
  if (radar_total || radar_chunk || radar_done || radar_count || radar_notice || radar_range) {
    radar_handle_dict(iter);
    return;
  }
#endif

  Tuple *status_t = dict_find(iter, MESSAGE_KEY_Status);
  if (status_t) {
    apply_status((int)tuple_int(status_t, STATUS_LOADING));
  }

  Tuple *loc_t = dict_find(iter, MESSAGE_KEY_Location);
  if (loc_t) {
    copy_tuple_str(g_weather.location, sizeof(g_weather.location), loc_t);
  }

  Tuple *cond1 = dict_find(iter, MESSAGE_KEY_CondLine1);
  Tuple *cond2 = dict_find(iter, MESSAGE_KEY_CondLine2);
  if (cond1 || cond2) {
    g_weather.now_temp = 99;
    g_weather.now_hum = -1;
    g_weather.now_delta = 99;
    g_weather.now_apparent = 99;
    g_weather.now_msl = 0;
    g_weather.now_wind_kmh = 0;
    g_weather.now_gust = 0;
    g_weather.now_dew = 0;
    g_weather.now_rain[0] = '\0';
    g_weather.has_now_temp = 0;
    g_weather.has_now_hum = 0;
    g_weather.has_now_delta = 0;
    g_weather.has_now_apparent = 0;
    g_weather.has_now_msl = 0;
    g_weather.has_now_wind_spd = 0;
    g_weather.has_now_gust = 0;
    g_weather.has_now_dew = 0;
    g_weather.has_now_rain = 0;
    g_weather.now_calc_flags = 0;
    g_weather.cond_wind[0] = '\0';
    g_weather.now_wind_dir[0] = '\0';
    g_weather.has_now = 0;
    if (cond1 && cond1->type == TUPLE_CSTRING && cond1->value->cstring[0]) {
      g_weather.now_temp = parse_tenths(cond1->value->cstring);
      g_weather.has_now_temp = 1;
      g_weather.has_now = 1;
    }
    if (cond2 && cond2->type == TUPLE_CSTRING) {
      char buf[160];
      strncpy(buf, cond2->value->cstring, sizeof(buf) - 1);
      buf[sizeof(buf) - 1] = '\0';
      char *fields[11];
      int n = 0;
      fields[n++] = buf;
      for (char *c = buf; *c && n < 11; c++) {
        if (*c == '\t') {
          *c = '\0';
          fields[n++] = c + 1;
        }
      }
      while (n < 11) {
        fields[n++] = "";
      }
      if (fields[0][0]) {
        g_weather.now_hum = parse_tenths(fields[0]);
        g_weather.has_now_hum = 1;
        g_weather.has_now = 1;
      }
      if (fields[1][0]) {
        g_weather.now_delta = parse_tenths(fields[1]);
        g_weather.has_now_delta = 1;
        g_weather.has_now = 1;
      }
      if (fields[2][0]) {
        strncpy(g_weather.cond_wind, fields[2], sizeof(g_weather.cond_wind) - 1);
        g_weather.cond_wind[sizeof(g_weather.cond_wind) - 1] = '\0';
        g_weather.has_now = 1;
      }
      if (fields[3][0]) {
        g_weather.now_apparent = parse_tenths(fields[3]);
        g_weather.has_now_apparent = 1;
        g_weather.has_now = 1;
      }
      if (fields[4][0]) {
        g_weather.now_msl = parse_tenths(fields[4]);
        g_weather.has_now_msl = 1;
        g_weather.has_now = 1;
      }
      if (fields[5][0]) {
        strncpy(g_weather.now_wind_dir, fields[5], sizeof(g_weather.now_wind_dir) - 1);
        g_weather.now_wind_dir[sizeof(g_weather.now_wind_dir) - 1] = '\0';
      }
      if (fields[6][0]) {
        g_weather.now_wind_kmh = parse_tenths(fields[6]);
        g_weather.has_now_wind_spd = 1;
      }
      if (fields[7][0]) {
        g_weather.now_gust = parse_tenths(fields[7]);
        g_weather.has_now_gust = 1;
      }
      if (fields[8][0]) {
        g_weather.now_dew = parse_tenths(fields[8]);
        g_weather.has_now_dew = 1;
      }
      if (fields[9][0]) {
        strncpy(g_weather.now_rain, fields[9], sizeof(g_weather.now_rain) - 1);
        g_weather.now_rain[sizeof(g_weather.now_rain) - 1] = '\0';
        g_weather.has_now_rain = 1;
      }
      if (fields[10][0]) {
        g_weather.now_calc_flags = atoi(fields[10]);
      }
    }
  }

  Tuple *warn_packed = dict_find(iter, MESSAGE_KEY_WarnPacked);
  Tuple *warn_title = dict_find(iter, MESSAGE_KEY_WarnTitle);
  if (warn_packed && warn_packed->type == TUPLE_CSTRING) {
    apply_warn_packed(warn_packed->value->cstring);
  } else if (warn_title) {
    copy_tuple_str(g_weather.warn_title, sizeof(g_weather.warn_title), warn_title);
    g_weather.has_warn = g_weather.warn_title[0] ? 1 : 0;
    g_weather.warn_count = g_weather.has_warn ? 1 : 0;
    if (g_weather.has_warn) {
      g_weather.warnings[0].type = WARN_OTHER;
      copy_str(g_weather.warnings[0].title, sizeof(g_weather.warnings[0].title), g_weather.warn_title);
    }
  }
  Tuple *warn_sub = dict_find(iter, MESSAGE_KEY_WarnSub);
  if (warn_sub) {
    copy_tuple_str(g_weather.warn_sub, sizeof(g_weather.warn_sub), warn_sub);
  }
  Tuple *warn_full = dict_find(iter, MESSAGE_KEY_WarnFull);
  if (warn_full) {
    copy_tuple_str(g_weather.warn_full, sizeof(g_weather.warn_full), warn_full);
    if (g_weather.warn_count == 1 && !g_weather.warnings[0].body[0]) {
      copy_str(g_weather.warnings[0].body, sizeof(g_weather.warnings[0].body), g_weather.warn_full);
    }
  }

  Tuple *cached_t = dict_find(iter, MESSAGE_KEY_Cached);
  if (cached_t) {
    g_weather.cached = tuple_int(cached_t, 0) ? 1 : 0;
  }
  Tuple *sun_t = dict_find(iter, MESSAGE_KEY_SunTimes);
  if (sun_t && sun_t->type == TUPLE_CSTRING) {
    const char *s = sun_t->value->cstring;
    const char *tab = strchr(s, '\t');
    if (tab) {
      size_t n = (size_t)(tab - s);
      if (n >= sizeof(g_weather.sunrise)) n = sizeof(g_weather.sunrise) - 1;
      memcpy(g_weather.sunrise, s, n);
      g_weather.sunrise[n] = '\0';
      copy_str(g_weather.sunset, sizeof(g_weather.sunset), tab + 1);
    }
  }
  Tuple *fdr_t = dict_find(iter, MESSAGE_KEY_FdrNow);
  if (fdr_t) {
    copy_tuple_str(g_weather.fdr, sizeof(g_weather.fdr), fdr_t);
  }

  Tuple *has_coastal = dict_find(iter, MESSAGE_KEY_HasCoastal);
  if (has_coastal) {
    g_weather.has_coastal = tuple_int(has_coastal, 0) ? 1 : 0;
  }

  Tuple *theme_t = dict_find(iter, MESSAGE_KEY_Theme);
  if (theme_t) {
    theme_set((int)tuple_int(theme_t, 0));
    forecast_menu_reload();
    day_detail_reload();
  }

  Tuple *warn_body = dict_find(iter, MESSAGE_KEY_WarnBody);
  if (warn_body && warn_body->type == TUPLE_CSTRING) {
    Tuple *di = dict_find(iter, MESSAGE_KEY_DetailIndex);
    int idx = di ? (int)tuple_int(di, 0) : g_weather.warn_view_index;
    if (idx == g_weather.warn_view_index) {
      copy_tuple_str(g_weather.warn_view_body, sizeof(g_weather.warn_view_body), warn_body);
    }
    forecast_menu_reload();
    return;
  }

  Tuple *coast_now = dict_find(iter, MESSAGE_KEY_CoastalNow);
  Tuple *packed = dict_find(iter, MESSAGE_KEY_DaysPacked);
  if (packed && packed->type == TUPLE_CSTRING && packed->length > 1) {
    apply_packed_days(packed->value->cstring);
    if (!has_coastal) {
      g_weather.has_coastal = 0;
    }
    if (coast_now) {
      copy_tuple_str(weather_coastal(0), weather_coastal_size(0), coast_now);
    }
    if (!cond1 && !cond2) {
      g_weather.has_now = 0;
      g_weather.has_now_temp = 0;
      g_weather.has_now_hum = 0;
      g_weather.has_now_delta = 0;
      g_weather.has_now_apparent = 0;
      g_weather.has_now_msl = 0;
      g_weather.has_now_wind_spd = 0;
      g_weather.has_now_gust = 0;
      g_weather.has_now_dew = 0;
      g_weather.has_now_rain = 0;
      g_weather.now_calc_flags = 0;
      g_weather.cond_wind[0] = '\0';
      g_weather.now_wind_dir[0] = '\0';
      g_weather.now_rain[0] = '\0';
    }
    if (!warn_title && !warn_packed) {
      clear_warnings();
    }
    if (g_weather.cached) {
      forecast_menu_toast("Using cached data");
    }
    persist_save();
    forecast_menu_reload();
    day_detail_reload();
    return;
  }

  Tuple *detail_t = dict_find(iter, MESSAGE_KEY_DetailIndex);
  Tuple *ext0 = dict_find(iter, MESSAGE_KEY_DayExtended);
  Tuple *coast0 = dict_find(iter, MESSAGE_KEY_DayCoastal);
  if (detail_t && (ext0 || coast0)) {
    int index = (int)tuple_int(detail_t, 0);
    if (index >= 0 && index < MAX_DAYS) {
      if (ext0) {
        copy_tuple_str(weather_extended(index), weather_extended_size(index), ext0);
      }
      if (coast0) {
        copy_tuple_str(weather_coastal(index), weather_coastal_size(index), coast0);
      }
#if defined(PBL_PLATFORM_APLITE)
      g_weather.view_detail_index = index;
#endif
      day_detail_reload();
    }
  }

  forecast_menu_reload();
}

static void inbox_dropped(AppMessageResult reason, void *context) {
  (void)context;
  APP_LOG(APP_LOG_LEVEL_ERROR, "Inbox dropped %d", (int)reason);
}

static void outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  (void)iter;
  (void)context;
  APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox failed %d", (int)reason);
}

static void init(void) {
  memset(&g_weather, 0, sizeof(g_weather));
#if defined(PBL_PLATFORM_APLITE)
  g_weather.view_detail_index = -1;
#endif
  apply_status(STATUS_LOADING);
  theme_init();
  persist_load();

  forecast_menu_init();
  day_detail_init();
#if HAS_RADAR
  radar_init();
#endif

  app_message_register_inbox_received(inbox_received);
  app_message_register_inbox_dropped(inbox_dropped);
  app_message_register_outbox_failed(outbox_failed);
  app_message_open(APPMSG_INBOX_SIZE, APPMSG_OUTBOX_SIZE);

#if defined(PBL_TOUCH)
  app_touch_navigation_enable(true);
#endif

  forecast_menu_show();
  weather_request(REQUEST_FORECAST, 0);
  app_timer_register(8000, cache_timeout, NULL);
}

static void deinit(void) {
#if HAS_RADAR
  radar_deinit();
#endif
  day_detail_deinit();
  forecast_menu_deinit();
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
