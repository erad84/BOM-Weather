#include "weather.h"
#include "weather_icon.h"
#include <string.h>

static Window *s_window;
static Layer *s_header;
static Layer *s_hint;
#define NUM_LINES 7
static TextLayer *s_lines[NUM_LINES];
static ScrollLayer *s_scroll;
static TextLayer *s_wrap;
static char s_line_text[NUM_LINES][48];
static char s_wrap_text[MAX_EXTENDED];
static Layer *s_compass;
static int s_show_compass;
static int s_index;
static int s_page;
static int s_pad;
static AppTimer *s_scroll_timer;
static int s_scroll_dir;
static int s_scroll_max;

#if defined(PBL_PLATFORM_GABBRO)
#define TOP_INSET 10
#define ICON_SIZE 36
#define TITLE_H 40
#define LINE_H 22
#define BODY_FONT FONT_KEY_GOTHIC_18
#define TITLE_FONT FONT_KEY_GOTHIC_18_BOLD
#elif defined(PBL_ROUND)
#define TOP_INSET 4
#define ICON_SIZE 22
#define TITLE_H 30
#define LINE_H 14
#define BODY_FONT FONT_KEY_GOTHIC_14
#define TITLE_FONT FONT_KEY_GOTHIC_14_BOLD
#elif defined(PBL_PLATFORM_EMERY)
#define TOP_INSET 4
#define ICON_SIZE 36
#define TITLE_H 40
#define LINE_H 20
#define BODY_FONT FONT_KEY_GOTHIC_18
#define TITLE_FONT FONT_KEY_GOTHIC_18_BOLD
#else
#define TOP_INSET 2
#define ICON_SIZE 26
#define TITLE_H 32
#define LINE_H 16
#define BODY_FONT FONT_KEY_GOTHIC_14
#define TITLE_FONT FONT_KEY_GOTHIC_18_BOLD
#endif

#define HEADER_H (TOP_INSET + ICON_SIZE + 4 + TITLE_H)
#define TITLE_H_SINGLE (TITLE_H / 2 + 4)
#define HEADER_H_CURRENT (TOP_INSET + ICON_SIZE + 4 + TITLE_H_SINGLE)
#define SCROLL_STEP_MS 110
#define SCROLL_PAUSE_MS 2000

static int header_height(void) {
  return s_index == DETAIL_CURRENT ? HEADER_H_CURRENT : HEADER_H;
}

static void suffix_mark(char *buf, size_t n, int bit, char mark) {
  if ((g_weather.now_calc_flags & bit) == 0) {
    return;
  }
  size_t len = strlen(buf);
  if (len + 1 < n) {
    buf[len] = mark;
    buf[len + 1] = '\0';
  }
}

#define FOOTNOTE_DUAL "* = Calculated  ^ = Nearby"
#define FOOTNOTE_DUAL_SHORT "* Calc  ^ Near"

static int uv_is_nearby(const char *uv) {
  return uv && uv[0] && strchr(uv, '^') != NULL;
}

static void format_obs_footnote(char *out, size_t n, int page_flags, int extra_caret) {
  int flags = g_weather.now_calc_flags & page_flags;
  int star = flags &
             (NOW_CALC_HUM | NOW_CALC_DELTA | NOW_CALC_APPARENT |
              NOW_CALC_DEW | NOW_CALC_MSL_INTERP);
  int caret = (flags & NOW_CALC_MSL_NEAR) || extra_caret;
  if (star && caret) {
    snprintf(out, n, FOOTNOTE_DUAL);
  } else if (star) {
    snprintf(out, n, "* = Calculated");
  } else if (flags & NOW_CALC_MSL_NEAR) {
    snprintf(out, n, "^ = Nearby station");
  } else if (caret) {
    snprintf(out, n, "^ = Nearby");
  } else {
    out[0] = '\0';
  }
}

static void fit_obs_footnote(int width) {
  char *text = s_line_text[NUM_LINES - 1];
  if (s_index != DETAIL_CURRENT || !text[0] ||
      strcmp(text, FOOTNOTE_DUAL) != 0) {
    return;
  }
  GFont font = fonts_get_system_font(BODY_FONT);
  GSize sz = graphics_text_layout_get_content_size(
      text, font, GRect(0, 0, 1000, LINE_H),
      GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft);
  if (sz.w <= width) {
    return;
  }
  snprintf(text, sizeof(s_line_text[NUM_LINES - 1]), FOOTNOTE_DUAL_SHORT);
}

static void set_line(int i, const char *text) {
  if (text && text[0]) {
    strncpy(s_line_text[i], text, sizeof(s_line_text[i]) - 1);
    s_line_text[i][sizeof(s_line_text[i]) - 1] = '\0';
  } else {
    s_line_text[i][0] = '\0';
  }
}

static void set_wrap(const char *text) {
  if (text && text[0]) {
    strncpy(s_wrap_text, text, sizeof(s_wrap_text) - 1);
    s_wrap_text[sizeof(s_wrap_text) - 1] = '\0';
  } else {
    s_wrap_text[0] = '\0';
  }
}

static void format_wind(char *out, size_t out_size) {
  char spd[12];
  if (g_weather.has_now_wind_spd && g_weather.now_wind_dir[0]) {
    format_tenths(spd, sizeof(spd), g_weather.now_wind_kmh);
    snprintf(out, out_size, "Wind %s %s km/h", g_weather.now_wind_dir, spd);
  } else if (g_weather.has_now_wind_spd) {
    format_tenths(spd, sizeof(spd), g_weather.now_wind_kmh);
    snprintf(out, out_size, "Wind %s km/h", spd);
  } else if (g_weather.cond_wind[0]) {
    snprintf(out, out_size, "Wind %s", g_weather.cond_wind);
  } else {
    snprintf(out, out_size, "Wind --");
  }
}

static void format_fdr(char *out, size_t out_size, const char *fdr) {
  if (fdr && fdr[0]) {
    snprintf(out, out_size, "Fire %s", fdr);
  } else {
    out[0] = '\0';
  }
}

static void format_sun(char *out, size_t out_size) {
  if (g_weather.sunrise[0] && g_weather.sunset[0]) {
    snprintf(out, out_size, "Sun %s-%s", g_weather.sunrise, g_weather.sunset);
  } else if (g_weather.sunrise[0]) {
    snprintf(out, out_size, "Sunrise %s", g_weather.sunrise);
  } else if (g_weather.sunset[0]) {
    snprintf(out, out_size, "Sunset %s", g_weather.sunset);
  } else {
    out[0] = '\0';
  }
}

static bool day_has_extra(void) {
  if (s_index < 0 || s_index >= g_weather.day_count) {
    return false;
  }
  DayForecast *d = &g_weather.days[s_index];
  return d->extended[0] && strcmp(d->extended, d->precis) != 0;
}

#define KIND_MAIN 0
#define KIND_COASTAL 1
#define KIND_EXTRA 2

static bool coastal_on(void) {
  return g_weather.has_coastal;
}

static bool has_extra_page(void) {
  return s_index == DETAIL_CURRENT || day_has_extra();
}

static int page_count(void) {
  int n = 1;
  if (coastal_on()) {
    n++;
  }
  if (has_extra_page()) {
    n++;
  }
  return n;
}

static int page_kind(void) {
  if (s_page <= 0) {
    return KIND_MAIN;
  }
  if (coastal_on() && s_page == 1) {
    return KIND_COASTAL;
  }
  return KIND_EXTRA;
}

static const char *coastal_text(void) {
  if (s_index == DETAIL_CURRENT) {
    const char *text = weather_coastal(0);
    return (g_weather.day_count > 0 && text[0]) ? text : "";
  }
  if (s_index >= 0 && s_index < g_weather.day_count) {
    return weather_coastal(s_index);
  }
  return "";
}

static bool show_select_hint(void) {
  return page_count() > 1;
}

static void auto_scroll_stop(void) {
  if (s_scroll_timer) {
    app_timer_cancel(s_scroll_timer);
    s_scroll_timer = NULL;
  }
  if (s_scroll) {
    scroll_layer_set_content_offset(s_scroll, GPoint(0, 0), false);
  }
}

static void auto_scroll_tick(void *data) {
  (void)data;
  s_scroll_timer = NULL;
  if (!s_scroll || s_scroll_max >= 0) {
    return;
  }
  GPoint off = scroll_layer_get_content_offset(s_scroll);
  int y = off.y;
  int delay = SCROLL_STEP_MS;
  if (s_scroll_dir > 0) {
    y -= 1;
    if (y <= s_scroll_max) {
      y = s_scroll_max;
      s_scroll_dir = -1;
      delay = SCROLL_PAUSE_MS;
    }
  } else {
    y += 1;
    if (y >= 0) {
      y = 0;
      s_scroll_dir = 1;
      delay = SCROLL_PAUSE_MS;
    }
  }
  scroll_layer_set_content_offset(s_scroll, GPoint(0, y), false);
  s_scroll_timer = app_timer_register(delay, auto_scroll_tick, NULL);
}

static void auto_scroll_start(int view_h, int content_h) {
  auto_scroll_stop();
  s_scroll_max = view_h - content_h;
  if (s_scroll_max > 0) {
    s_scroll_max = 0;
  }
  if (s_scroll_max >= 0 || !s_scroll) {
    return;
  }
  s_scroll_dir = 1;
  s_scroll_timer = app_timer_register(SCROLL_PAUSE_MS, auto_scroll_tick, NULL);
}

static void rebuild_lines(void) {
  for (int i = 0; i < NUM_LINES; i++) {
    s_line_text[i][0] = '\0';
  }
  s_wrap_text[0] = '\0';
  s_show_compass = 0;
  if (page_kind() == KIND_COASTAL) {
    const char *text = coastal_text();
    set_wrap(text[0] ? text : "No coastal details.");
    return;
  }
  if (s_index == DETAIL_CURRENT) {
    if (page_kind() == KIND_MAIN) {
      char temp[32];
      char rainnow[32];
      char hum[32];
      char wind[40];
      char uv[32];
      char fdr[40];
      char note[48];
      if (g_weather.has_now_temp) {
        char t[12];
        format_tenths(t, sizeof(t), g_weather.now_temp);
        snprintf(temp, sizeof(temp), "Temperature %s\xC2\xB0" "C", t);
      } else {
        snprintf(temp, sizeof(temp), "Temperature --");
      }
      if (g_weather.has_now_rain) {
        snprintf(rainnow, sizeof(rainnow), "Rain %s mm", g_weather.now_rain);
      } else {
        snprintf(rainnow, sizeof(rainnow), "Rain --");
      }
      if (g_weather.has_now_hum) {
        char h[12];
        format_tenths(h, sizeof(h), g_weather.now_hum);
        snprintf(hum, sizeof(hum), "Humidity %s%%", h);
        suffix_mark(hum, sizeof(hum), NOW_CALC_HUM, '*');
      } else {
        snprintf(hum, sizeof(hum), "Humidity --");
      }
      format_wind(wind, sizeof(wind));
      if (g_weather.day_count > 0 && g_weather.days[0].uv[0]) {
        snprintf(uv, sizeof(uv), "UV %s", g_weather.days[0].uv);
      } else {
        snprintf(uv, sizeof(uv), "UV --");
      }
      format_fdr(fdr, sizeof(fdr), g_weather.fdr[0] ? g_weather.fdr :
                 (g_weather.day_count > 0 ? g_weather.days[0].fdr : ""));
      s_show_compass = g_weather.now_wind_dir[0] != '\0';
      set_line(0, temp);
      set_line(1, rainnow);
      set_line(2, hum);
      set_line(3, wind);
      set_line(4, uv);
      set_line(5, fdr);
      format_obs_footnote(note, sizeof(note), NOW_CALC_HUM,
                          g_weather.day_count > 0 && uv_is_nearby(g_weather.days[0].uv));
      set_line(6, note);
    } else {
      char app[32];
      char msl[32];
      char gust[32];
      char dew[32];
      char delta[32];
      char sun[32];
      char note[48];
      if (g_weather.has_now_apparent) {
        char t[12];
        format_tenths(t, sizeof(t), g_weather.now_apparent);
        snprintf(app, sizeof(app), "Apparent %s\xC2\xB0" "C", t);
        suffix_mark(app, sizeof(app), NOW_CALC_APPARENT, '*');
      } else {
        snprintf(app, sizeof(app), "Apparent --");
      }
      if (g_weather.has_now_msl) {
        char p[12];
        format_tenths(p, sizeof(p), g_weather.now_msl);
        snprintf(msl, sizeof(msl), "MSL %s hPa", p);
        if (g_weather.now_calc_flags & NOW_CALC_MSL_NEAR) {
          suffix_mark(msl, sizeof(msl), NOW_CALC_MSL_NEAR, '^');
        } else {
          suffix_mark(msl, sizeof(msl), NOW_CALC_MSL_INTERP, '*');
        }
      } else {
        snprintf(msl, sizeof(msl), "MSL --");
      }
      if (g_weather.has_now_gust) {
        char g[12];
        format_tenths(g, sizeof(g), g_weather.now_gust);
        snprintf(gust, sizeof(gust), "Gust %s km/h", g);
      } else {
        snprintf(gust, sizeof(gust), "Gust --");
      }
      if (g_weather.has_now_dew) {
        char t[12];
        format_tenths(t, sizeof(t), g_weather.now_dew);
        snprintf(dew, sizeof(dew), "Dew %s\xC2\xB0" "C", t);
        suffix_mark(dew, sizeof(dew), NOW_CALC_DEW, '*');
      } else {
        snprintf(dew, sizeof(dew), "Dew --");
      }
      if (g_weather.has_now_delta) {
        char t[12];
        format_tenths(t, sizeof(t), g_weather.now_delta);
        snprintf(delta, sizeof(delta), "Delta-T %s\xC2\xB0" "C", t);
        suffix_mark(delta, sizeof(delta), NOW_CALC_DELTA, '*');
      } else {
        snprintf(delta, sizeof(delta), "Delta-T --");
      }
      format_sun(sun, sizeof(sun));
      set_line(0, app);
      set_line(1, msl);
      set_line(2, gust);
      set_line(3, dew);
      set_line(4, delta);
      set_line(5, sun);
      format_obs_footnote(note, sizeof(note),
                          NOW_CALC_APPARENT | NOW_CALC_DEW | NOW_CALC_DELTA |
                          NOW_CALC_MSL_NEAR | NOW_CALC_MSL_INTERP, 0);
      set_line(6, note);
    }
    return;
  }
  if (s_index < 0 || s_index >= g_weather.day_count) {
    set_line(0, "No forecast.");
    return;
  }

  DayForecast *d = &g_weather.days[s_index];
  if (page_kind() == KIND_EXTRA) {
    set_wrap(weather_extended(s_index)[0] ? weather_extended(s_index) : d->precis);
    return;
  }

  char temps[36];
  if (d->min == TEMP_NONE && d->max == TEMP_NONE) {
    snprintf(temps, sizeof(temps), "Temps unavailable");
  } else if (d->min == TEMP_NONE) {
    char hi[12];
    format_tenths(hi, sizeof(hi), d->max);
    snprintf(temps, sizeof(temps), "Max %s\xC2\xB0" "C", hi);
  } else if (d->max == TEMP_NONE) {
    char lo[12];
    format_tenths(lo, sizeof(lo), d->min);
    snprintf(temps, sizeof(temps), "Min %s\xC2\xB0" "C", lo);
  } else {
    char lo[12];
    char hi[12];
    format_tenths(lo, sizeof(lo), d->min);
    format_tenths(hi, sizeof(hi), d->max);
    snprintf(temps, sizeof(temps), "Min %s  Max %s\xC2\xB0" "C", lo, hi);
  }

  char rain[48];
  if (d->rain_chance >= 0) {
    snprintf(rain, sizeof(rain), "Rain %d%%", d->rain_chance);
  } else {
    snprintf(rain, sizeof(rain), "Rain --");
  }

  char amount[48];
  if (d->rain_amount[0]) {
    snprintf(amount, sizeof(amount), "Rain %s", d->rain_amount);
  } else {
    amount[0] = '\0';
  }

  char uv[32];
  if (d->uv[0]) {
    snprintf(uv, sizeof(uv), "UV %s", d->uv);
  } else {
    uv[0] = '\0';
  }

  set_line(0, temps);
  set_line(1, d->precis[0] ? d->precis : "Loading details...");
  set_line(2, rain);
  set_line(3, amount);
  set_line(4, uv);
  char fdr[40];
  format_fdr(fdr, sizeof(fdr), d->fdr);
  set_line(5, fdr);
  if (uv_is_nearby(d->uv)) {
    set_line(6, "^ = Nearby");
  }
}

static void layout_body(void) {
  if (!s_window) {
    return;
  }
  GRect bounds = layer_get_bounds(window_get_root_layer(s_window));
  int w = bounds.size.w - (s_pad * 2);
  int i;
  int hh = header_height();
  auto_scroll_stop();

  if (s_header) {
    layer_set_frame(s_header, GRect(0, 0, bounds.size.w, hh));
  }

  bool extra_page = (page_kind() == KIND_COASTAL) ||
                    (page_kind() == KIND_EXTRA && s_index != DETAIL_CURRENT);
  if (s_scroll) {
    layer_set_hidden(scroll_layer_get_layer(s_scroll), !extra_page);
  }

  if (extra_page) {
    if (s_compass) {
      layer_set_hidden(s_compass, true);
    }
    for (i = 0; i < NUM_LINES; i++) {
      if (s_lines[i]) {
        layer_set_hidden(text_layer_get_layer(s_lines[i]), true);
      }
    }
    int view_h = bounds.size.h - hh - PBL_IF_ROUND_ELSE(18, 6);
    if (view_h < LINE_H * 3) {
      view_h = LINE_H * 3;
    }
    if (s_scroll && s_wrap) {
      layer_set_frame(scroll_layer_get_layer(s_scroll), GRect(s_pad, hh, w, view_h));
      text_layer_set_text_alignment(s_wrap, GTextAlignmentCenter);
      text_layer_set_overflow_mode(s_wrap, GTextOverflowModeWordWrap);
      text_layer_set_size(s_wrap, GSize(w, 2000));
      text_layer_set_text(s_wrap, s_wrap_text);
      GSize sz = text_layer_get_content_size(s_wrap);
      int content_h = sz.h + 12;
      if (content_h < view_h) {
        content_h = view_h;
      }
      text_layer_set_size(s_wrap, GSize(w, content_h));
      scroll_layer_set_content_size(s_scroll, GSize(w, content_h));
      auto_scroll_start(view_h, content_h);
    }
    return;
  }

  if (s_compass) {
    layer_set_hidden(s_compass, true);
  }

  fit_obs_footnote(w);

  int y = hh;
  for (i = 0; i < NUM_LINES; i++) {
    if (!s_lines[i]) {
      continue;
    }
    if (!s_line_text[i][0]) {
      layer_set_hidden(text_layer_get_layer(s_lines[i]), true);
      continue;
    }
    layer_set_hidden(text_layer_get_layer(s_lines[i]), false);
    int x = s_pad;
    int lw = w;
    if (s_show_compass && i == 3) {
      int cw = LINE_H;
      GFont font = fonts_get_system_font(BODY_FONT);
      GSize ts = graphics_text_layout_get_content_size(
          s_line_text[i], font, GRect(0, 0, w - cw - 4, LINE_H),
          GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft);
      int gap = 4;
      int total = cw + gap + ts.w;
      if (total > w) {
        total = w;
      }
      int start = s_pad + (w - total) / 2;
      if (s_compass) {
        layer_set_frame(s_compass, GRect(start, y, cw, LINE_H));
        layer_set_hidden(s_compass, false);
        layer_mark_dirty(s_compass);
      }
      x = start + cw + gap;
      lw = total - cw - gap;
      text_layer_set_text_alignment(s_lines[i], GTextAlignmentLeft);
    } else if (i == NUM_LINES - 1 && s_line_text[i][0] &&
               (s_line_text[i][0] == '*' || s_line_text[i][0] == '^')) {
      text_layer_set_text_alignment(s_lines[i], GTextAlignmentLeft);
    } else if (s_index == DETAIL_CURRENT && i == NUM_LINES - 1) {
      text_layer_set_text_alignment(s_lines[i], GTextAlignmentLeft);
    } else {
      text_layer_set_text_alignment(s_lines[i], GTextAlignmentCenter);
    }
    layer_set_frame(text_layer_get_layer(s_lines[i]), GRect(x, y, lw, LINE_H));
    y += LINE_H;
  }
}

static void apply_lines(void) {
  rebuild_lines();
  layout_body();
  for (int i = 0; i < NUM_LINES; i++) {
    if (s_lines[i]) {
      text_layer_set_overflow_mode(s_lines[i], GTextOverflowModeTrailingEllipsis);
      text_layer_set_text(s_lines[i], s_line_text[i]);
    }
  }
  if (s_hint) {
    layer_mark_dirty(s_hint);
  }
}

static void header_update(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  int icon = 0;
  const char *title = "";
  if (s_index == DETAIL_CURRENT) {
    icon = g_weather.day_count > 0 ? g_weather.days[0].icon : 0;
    title = page_kind() == KIND_COASTAL ? "Coastal" : "Current";
  } else if (s_index >= 0 && s_index < g_weather.day_count) {
    icon = g_weather.days[s_index].icon;
    if (page_kind() == KIND_COASTAL) {
      title = "Coastal";
    } else {
      title = g_weather.days[s_index].title[0] ? g_weather.days[s_index].title
                                               : g_weather.days[s_index].name;
    }
  }

  GRect box = GRect((bounds.size.w - ICON_SIZE) / 2, TOP_INSET, ICON_SIZE, ICON_SIZE);
  weather_icon_draw(ctx, box, icon);

  char weekday[16];
  const char *date = title;
  weekday[0] = '\0';
  const char *space = strchr(title, ' ');
  if (space && space != title) {
    int n = (int)(space - title);
    if (n > (int)sizeof(weekday) - 1) {
      n = (int)sizeof(weekday) - 1;
    }
    memcpy(weekday, title, (size_t)n);
    weekday[n] = '\0';
    date = space + 1;
  }

  graphics_context_set_text_color(ctx, theme_fg());
  const GFont font = fonts_get_system_font(TITLE_FONT);
  if (weekday[0]) {
    GRect line1 = GRect(4, TOP_INSET + ICON_SIZE, bounds.size.w - 8, TITLE_H / 2);
    GRect line2 = GRect(4, TOP_INSET + ICON_SIZE + TITLE_H / 2 - 2, bounds.size.w - 8, TITLE_H / 2);
    graphics_draw_text(ctx, weekday, font, line1,
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
    graphics_draw_text(ctx, date, font, line2,
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  } else {
    int title_h = bounds.size.h - TOP_INSET - ICON_SIZE;
    if (title_h < TITLE_H_SINGLE) {
      title_h = TITLE_H_SINGLE;
    }
    GRect title_box = GRect(4, TOP_INSET + ICON_SIZE, bounds.size.w - 8, title_h);
    graphics_draw_text(ctx, title, font, title_box,
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  }
}

static bool can_prev_day(void) {
  return s_index != DETAIL_CURRENT;
}

static bool can_next_day(void) {
  if (s_index == DETAIL_CURRENT) {
    return g_weather.day_count > 0;
  }
  return s_index + 1 < g_weather.day_count;
}

static void fill_tri(GContext *ctx, GPoint a, GPoint b, GPoint c) {
  GPoint pts[3] = {a, b, c};
  GPathInfo info = { .num_points = 3, .points = pts };
  GPath *path = gpath_create(&info);
  graphics_context_set_fill_color(ctx, theme_fg());
  gpath_draw_filled(ctx, path);
  gpath_destroy(path);
}

static void hint_update(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  int cx = bounds.size.w - PBL_IF_ROUND_ELSE(22, 10);
  if (can_prev_day()) {
    int y = PBL_IF_ROUND_ELSE(26, 14);
    fill_tri(ctx, GPoint(cx, y - 4), GPoint(cx - 5, y + 5), GPoint(cx + 5, y + 5));
  }
  if (can_next_day()) {
    int y = bounds.size.h - PBL_IF_ROUND_ELSE(26, 14);
    fill_tri(ctx, GPoint(cx, y + 4), GPoint(cx - 5, y - 5), GPoint(cx + 5, y - 5));
  }
  if (!show_select_hint()) {
    return;
  }
  int cy = bounds.size.h / 2;
  if (s_page + 1 < page_count()) {
    fill_tri(ctx, GPoint(cx - 5, cy - 6), GPoint(cx - 5, cy + 6), GPoint(cx + 3, cy));
  } else {
    fill_tri(ctx, GPoint(cx + 3, cy - 6), GPoint(cx + 3, cy + 6), GPoint(cx - 5, cy));
  }
}

static void compass_update(Layer *layer, GContext *ctx) {
  (void)layer;
  if (!s_show_compass) {
    return;
  }
  wind_compass_draw(ctx, layer_get_bounds(layer), g_weather.now_wind_dir);
}

static void request_day_detail(int index) {
  if (index < 0 || index >= g_weather.day_count) {
    return;
  }
#if defined(PBL_PLATFORM_APLITE)
  if (g_weather.view_detail_index == index && weather_extended(index)[0] &&
      (!coastal_on() || weather_coastal(index)[0])) {
    return;
  }
#else
  DayForecast *d = &g_weather.days[index];
  if (!d->extended[0] || (coastal_on() && !d->coastal[0])) {
#endif
    weather_request(REQUEST_DETAIL, index);
#if !defined(PBL_PLATFORM_APLITE)
  }
#endif
}

static void load_day(int index) {
  s_page = 0;
  if (index == DETAIL_CURRENT) {
    s_index = DETAIL_CURRENT;
    if (coastal_on()) {
      request_day_detail(0);
    }
    apply_lines();
    if (s_header) {
      layer_mark_dirty(s_header);
    }
    return;
  }
  if (index < 0 || index >= g_weather.day_count) {
    return;
  }
  s_index = index;
  request_day_detail(index);
  apply_lines();
  if (s_header) {
    layer_mark_dirty(s_header);
  }
}

static void cycle_page(int dir) {
  int n = page_count();
  if (n <= 1) {
    return;
  }
  s_page = (s_page + dir) % n;
  if (s_page < 0) {
    s_page += n;
  }
  apply_lines();
  if (s_header) {
    layer_mark_dirty(s_header);
  }
}

static void go_prev_day(void) {
  if (s_index == DETAIL_CURRENT) {
    return;
  }
  if (s_index == 0) {
    load_day(DETAIL_CURRENT);
    return;
  }
  if (s_index > 0) {
    load_day(s_index - 1);
  }
}

static void go_next_day(void) {
  if (s_index == DETAIL_CURRENT) {
    if (g_weather.day_count > 0) {
      load_day(0);
    }
    return;
  }
  if (s_index + 1 < g_weather.day_count) {
    load_day(s_index + 1);
  }
}

static void up_click(ClickRecognizerRef rec, void *ctx) {
  (void)rec;
  (void)ctx;
  go_prev_day();
}

static void down_click(ClickRecognizerRef rec, void *ctx) {
  (void)rec;
  (void)ctx;
  go_next_day();
}

static void select_click(ClickRecognizerRef rec, void *ctx) {
  (void)rec;
  (void)ctx;
  cycle_page(1);
}

#if defined(PBL_TOUCH)
static void tap_touch(const Recognizer *recognizer, RecognizerEvent event) {
  (void)recognizer;
  if (event == RecognizerEvent_Completed) {
    cycle_page(1);
  }
}

static void swipe_touch(const Recognizer *recognizer, RecognizerEvent event) {
  if (event != RecognizerEvent_Completed) {
    return;
  }
  switch (swipe_recognizer_get_direction(recognizer)) {
    case SwipeDirection_Up:
      go_next_day();
      break;
    case SwipeDirection_Down:
      go_prev_day();
      break;
    case SwipeDirection_Left:
      cycle_page(1);
      break;
    case SwipeDirection_Right:
      cycle_page(-1);
      break;
    default:
      break;
  }
}

static void attach_touch(Window *window) {
  window_set_touch_bridge_disabled(window, true);
  Recognizer *swipe = swipe_recognizer_create(
      swipe_touch, NULL,
      (uint8_t)(SwipeDirection_Up | SwipeDirection_Down | SwipeDirection_Left |
                SwipeDirection_Right));
  Recognizer *tap = tap_recognizer_create(tap_touch, NULL);
  recognizer_set_fail_after(tap, swipe);
  window_attach_recognizer(window, swipe);
  window_attach_recognizer(window, tap);
}
#endif

static void click_config(void *ctx) {
  (void)ctx;
  window_single_click_subscribe(BUTTON_ID_UP, up_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  s_pad = PBL_IF_ROUND_ELSE((PBL_DISPLAY_WIDTH >= 200 ? 28 : 16), 6);

  s_header = layer_create(GRect(0, 0, bounds.size.w, HEADER_H));
  layer_set_update_proc(s_header, header_update);
  layer_add_child(root, s_header);

  rebuild_lines();
  int y = HEADER_H;
  int w = bounds.size.w - (s_pad * 2);
  for (int i = 0; i < NUM_LINES; i++) {
    s_lines[i] = text_layer_create(GRect(s_pad, y, w, LINE_H));
    text_layer_set_font(s_lines[i], fonts_get_system_font(BODY_FONT));
    text_layer_set_text_alignment(s_lines[i], GTextAlignmentCenter);
    text_layer_set_overflow_mode(s_lines[i], GTextOverflowModeTrailingEllipsis);
    text_layer_set_text_color(s_lines[i], theme_fg());
    text_layer_set_background_color(s_lines[i], GColorClear);
    text_layer_set_text(s_lines[i], s_line_text[i]);
    layer_add_child(root, text_layer_get_layer(s_lines[i]));
    y += LINE_H;
  }

  int view_h = bounds.size.h - HEADER_H - PBL_IF_ROUND_ELSE(18, 6);
  s_scroll = scroll_layer_create(GRect(s_pad, HEADER_H, w, view_h));
  s_wrap = text_layer_create(GRect(0, 0, w, 2000));
  text_layer_set_font(s_wrap, fonts_get_system_font(BODY_FONT));
  text_layer_set_text_alignment(s_wrap, GTextAlignmentCenter);
  text_layer_set_overflow_mode(s_wrap, GTextOverflowModeWordWrap);
  text_layer_set_text_color(s_wrap, theme_fg());
  text_layer_set_background_color(s_wrap, GColorClear);
  scroll_layer_add_child(s_scroll, text_layer_get_layer(s_wrap));
  layer_add_child(root, scroll_layer_get_layer(s_scroll));
  layer_set_hidden(scroll_layer_get_layer(s_scroll), true);

  s_compass = layer_create(GRect(0, 0, LINE_H, LINE_H));
  layer_set_update_proc(s_compass, compass_update);
  layer_add_child(root, s_compass);
  layer_set_hidden(s_compass, true);

  s_hint = layer_create(bounds);
  layer_set_update_proc(s_hint, hint_update);
  layer_add_child(root, s_hint);

  apply_lines();
  window_set_click_config_provider(window, click_config);
#if defined(PBL_TOUCH)
  attach_touch(window);
#endif
}

static void window_unload(Window *window) {
  (void)window;
  auto_scroll_stop();
  for (int i = 0; i < NUM_LINES; i++) {
    text_layer_destroy(s_lines[i]);
    s_lines[i] = NULL;
  }
  text_layer_destroy(s_wrap);
  s_wrap = NULL;
  scroll_layer_destroy(s_scroll);
  s_scroll = NULL;
  if (s_compass) {
    layer_destroy(s_compass);
    s_compass = NULL;
  }
  layer_destroy(s_hint);
  s_hint = NULL;
  layer_destroy(s_header);
  s_header = NULL;
}

void day_detail_init(void) {
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .unload = window_unload,
  });
  window_set_background_color(s_window, theme_bg());
}

void day_detail_deinit(void) {
  window_destroy(s_window);
}

void day_detail_show(int index) {
  s_index = index;
  s_page = 0;
  if (index == DETAIL_CURRENT) {
    request_day_detail(0);
  } else {
    request_day_detail(index);
  }
  if (window_stack_get_top_window() != s_window) {
    window_stack_push(s_window, true);
  } else {
    load_day(index);
  }
}

void day_detail_reload(void) {
  if (s_window) {
    window_set_background_color(s_window, theme_bg());
  }
  if (!s_header) {
    return;
  }
  for (int i = 0; i < NUM_LINES; i++) {
    if (s_lines[i]) {
      text_layer_set_text_color(s_lines[i], theme_fg());
    }
  }
  if (s_wrap) {
    text_layer_set_text_color(s_wrap, theme_fg());
  }
  apply_lines();
  layer_mark_dirty(s_header);
  if (s_hint) {
    layer_mark_dirty(s_hint);
  }
  if (s_compass) {
    layer_mark_dirty(s_compass);
  }
}
