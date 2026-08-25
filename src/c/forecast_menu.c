#include "weather.h"
#include "weather_icon.h"
#include <string.h>

static Window *s_window;
static MenuLayer *s_menu;
static Window *s_warn_window;
static ScrollLayer *s_warn_scroll;
static Layer *s_warn_canvas;
static Layer *s_warn_hint;
static TextLayer *s_toast;
static char s_toast_text[48];
static AppTimer *s_toast_timer;
#if defined(PBL_TOUCH)
static int s_warn_pan_base;
#endif

#define WARN_ICON_S 56

static int radar_rows(void) {
  return HAS_RADAR ? 1 : 0;
}

static int extra_rows(void) {
  return (g_weather.has_warn ? 1 : 0) + (g_weather.has_now ? 1 : 0);
}

static bool is_radar_row(MenuIndex *index) {
  return HAS_RADAR && index->row == 0;
}

static bool is_warn_row(MenuIndex *index) {
  return g_weather.has_warn && index->row == (uint16_t)radar_rows();
}

static bool is_now_row(MenuIndex *index) {
  if (!g_weather.has_now) {
    return false;
  }
  return index->row == (uint16_t)(radar_rows() + (g_weather.has_warn ? 1 : 0));
}

static int day_index_for_row(uint16_t row) {
  return (int)row - radar_rows() - extra_rows();
}

static uint16_t get_num_sections(MenuLayer *layer, void *ctx) {
  (void)layer;
  (void)ctx;
  return 1;
}

static uint16_t get_num_rows(MenuLayer *layer, uint16_t section, void *ctx) {
  (void)layer;
  (void)section;
  (void)ctx;
  uint16_t extra = (uint16_t)(radar_rows() + extra_rows());
  if (g_weather.day_count > 0) {
    return (uint16_t)(extra + g_weather.day_count);
  }
  return (uint16_t)(extra + 1);
}

static int16_t get_header_height(MenuLayer *layer, uint16_t section, void *ctx) {
  (void)layer;
  (void)section;
  (void)ctx;
  return MENU_CELL_BASIC_HEADER_HEIGHT;
}

static int16_t get_cell_height(MenuLayer *layer, MenuIndex *index, void *ctx) {
  (void)layer;
  (void)index;
  (void)ctx;
#if defined(PBL_PLATFORM_GABBRO)
  return 58;
#elif defined(PBL_ROUND)
  return 52;
#elif defined(PBL_PLATFORM_EMERY)
  return 50;
#else
  return 44;
#endif
}

static void draw_header(GContext *ctx, const Layer *cell_layer, uint16_t section,
                        void *callback_context) {
  (void)section;
  (void)callback_context;
  const char *title = g_weather.location[0] ? g_weather.location : "BOM Weather";
  GRect bounds = layer_get_bounds(cell_layer);
  graphics_context_set_text_color(ctx, theme_fg());
  graphics_draw_text(ctx, title, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                     bounds, GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
}

static void format_temps(char *out, size_t out_size, DayForecast *day) {
  if (day->min == 99 && day->max == 99) {
    snprintf(out, out_size, "%s", day->precis);
  } else if (day->min == 99) {
    snprintf(out, out_size, "max %d\xC2\xB0" "C  %s", day->max, day->precis);
  } else if (day->max == 99) {
    snprintf(out, out_size, "min %d\xC2\xB0" "C  %s", day->min, day->precis);
  } else {
    snprintf(out, out_size, "%d\xC2\xB0" "C - %d\xC2\xB0" "C  %s", day->min, day->max, day->precis);
  }
}

static int current_icon(void) {
  if (g_weather.day_count > 0) {
    return g_weather.days[0].icon;
  }
  return ICON_UNKNOWN;
}

static const char *current_uv(void) {
  if (g_weather.day_count > 0 && g_weather.days[0].uv[0]) {
    return g_weather.days[0].uv;
  }
  return "";
}

static void format_current_title(char *out, size_t out_size) {
  if (g_weather.has_now_temp) {
    snprintf(out, out_size, "Current - %d\xC2\xB0" "C", g_weather.now_temp);
  } else {
    snprintf(out, out_size, "Current");
  }
}

static void format_current_sub(char *out, size_t out_size) {
  char hum[12];
  char uv[20];
  hum[0] = '\0';
  uv[0] = '\0';
  if (g_weather.has_now_hum) {
    snprintf(hum, sizeof(hum), "H:%d%%", g_weather.now_hum);
  }
  if (current_uv()[0]) {
    snprintf(uv, sizeof(uv), "UV %s", current_uv());
  }
  if (hum[0] && uv[0] && g_weather.cond_wind[0]) {
    snprintf(out, out_size, "%s %s %s", hum, uv, g_weather.cond_wind);
  } else if (hum[0] && uv[0]) {
    snprintf(out, out_size, "%s %s", hum, uv);
  } else if (hum[0] && g_weather.cond_wind[0]) {
    snprintf(out, out_size, "%s %s", hum, g_weather.cond_wind);
  } else if (uv[0] && g_weather.cond_wind[0]) {
    snprintf(out, out_size, "%s %s", uv, g_weather.cond_wind);
  } else if (hum[0]) {
    snprintf(out, out_size, "%s", hum);
  } else if (uv[0]) {
    snprintf(out, out_size, "%s", uv);
  } else if (g_weather.cond_wind[0]) {
    snprintf(out, out_size, "%s", g_weather.cond_wind);
  } else {
    snprintf(out, out_size, "Current conditions");
  }
}

static void draw_named_row(GContext *ctx, const Layer *cell_layer, int icon,
                           const char *title, const char *subtitle) {
  GRect bounds = layer_get_bounds(cell_layer);
  const int icon_s = PBL_IF_ROUND_ELSE(26, 28);
  const int pad = PBL_IF_ROUND_ELSE(8, 4);
  GRect icon_box = GRect(bounds.origin.x + pad,
                         bounds.origin.y + (bounds.size.h - icon_s) / 2,
                         icon_s, icon_s);
  weather_icon_draw(ctx, icon_box, icon);

  const int text_x = icon_box.origin.x + icon_s + 6;
  GRect title_box = GRect(text_x, bounds.origin.y + 2,
                          bounds.size.w - text_x - 4, bounds.size.h / 2);
  GRect sub_box = GRect(text_x, bounds.origin.y + bounds.size.h / 2 - 2,
                        bounds.size.w - text_x - 4, bounds.size.h / 2);
  graphics_context_set_text_color(ctx,
      menu_cell_layer_is_highlighted(cell_layer) ? theme_hi_fg() : theme_fg());
  graphics_draw_text(ctx, title, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     title_box, GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  graphics_draw_text(ctx, subtitle, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     sub_box, GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
}

static void draw_warn_row(GContext *ctx, const Layer *cell_layer) {
  GRect bounds = layer_get_bounds(cell_layer);
#ifdef PBL_COLOR
  GColor bg = menu_cell_layer_is_highlighted(cell_layer) ? GColorYellow : GColorChromeYellow;
  graphics_context_set_fill_color(ctx, bg);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);
  graphics_context_set_text_color(ctx, GColorBlack);
#else
  graphics_context_set_fill_color(ctx, theme_is_light() ? GColorBlack : GColorWhite);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);
  graphics_context_set_text_color(ctx, theme_is_light() ? GColorWhite : GColorBlack);
#endif
  const int icon_s = PBL_IF_ROUND_ELSE(26, 28);
  const int pad = PBL_IF_ROUND_ELSE(8, 4);
  int x = bounds.origin.x + pad;
  int y = bounds.origin.y + (bounds.size.h - icon_s) / 2;
  int icon_type = WARN_OTHER;
  if (g_weather.warn_count == 1 && g_weather.warnings[0].type > 0) {
    icon_type = g_weather.warnings[0].type;
  }
#ifdef PBL_COLOR
  warn_icon_draw(ctx, GRect(x, y, icon_s, icon_s), icon_type);
#else
  warn_icon_draw_ink(ctx, GRect(x, y, icon_s, icon_s), icon_type,
                     theme_is_light() ? GColorWhite : GColorBlack);
#endif
  x += icon_s + 2;
  const int text_x = x + 4;
  GRect title_box = GRect(text_x, bounds.origin.y + 2,
                          bounds.size.w - text_x - 4, bounds.size.h / 2);
  GRect sub_box = GRect(text_x, bounds.origin.y + bounds.size.h / 2 - 2,
                        bounds.size.w - text_x - 4, bounds.size.h / 2);
  graphics_draw_text(ctx, g_weather.warn_title[0] ? g_weather.warn_title : "Warnings",
                     fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     title_box, GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  char sub[48];
  if (g_weather.warn_count > 1) {
    snprintf(sub, sizeof(sub), "%d warnings", g_weather.warn_count);
  } else {
    snprintf(sub, sizeof(sub), "%s",
             g_weather.warn_sub[0] ? g_weather.warn_sub : "Details");
  }
  graphics_draw_text(ctx, sub, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     sub_box, GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
}

static void draw_row(GContext *ctx, const Layer *cell_layer, MenuIndex *index,
                     void *callback_context) {
  (void)callback_context;
  if (is_radar_row(index)) {
    menu_cell_basic_draw(ctx, cell_layer, "Rain radar / Synoptic", "Select to loop", NULL);
    return;
  }
  if (is_warn_row(index)) {
    draw_warn_row(ctx, cell_layer);
    return;
  }
  if (is_now_row(index)) {
    char title[32];
    char sub[64];
    format_current_title(title, sizeof(title));
    format_current_sub(sub, sizeof(sub));
    draw_named_row(ctx, cell_layer, current_icon(), title, sub);
    return;
  }

  if (g_weather.day_count == 0) {
    const char *msg = g_weather.status_text[0] ? g_weather.status_text : "Waiting for phone...";
    const char *sub = g_weather.location[0] ? g_weather.location : "Open phone settings if this stays";
    menu_cell_basic_draw(ctx, cell_layer, msg, sub, NULL);
    return;
  }

  int day_i = day_index_for_row(index->row);
  if (day_i < 0 || day_i >= g_weather.day_count) {
    return;
  }
  DayForecast *day = &g_weather.days[day_i];
  char subtitle[64];
  format_temps(subtitle, sizeof(subtitle), day);
  draw_named_row(ctx, cell_layer, day->icon, day->name, subtitle);
}

#if defined(PBL_TOUCH)
static void warn_pan_touch(const Recognizer *recognizer, RecognizerEvent event) {
  if (!s_warn_scroll) {
    return;
  }
  switch (event) {
    case RecognizerEvent_Started:
      s_warn_pan_base = scroll_layer_get_content_offset(s_warn_scroll).y;
      break;
    case RecognizerEvent_Updated: {
      GPoint d = pan_recognizer_get_delta_since_start(recognizer);
      scroll_layer_set_content_offset(s_warn_scroll, GPoint(0, s_warn_pan_base + d.y), false);
      if (s_warn_hint) {
        layer_mark_dirty(s_warn_hint);
      }
      break;
    }
    case RecognizerEvent_Completed:
      s_warn_pan_base = scroll_layer_get_content_offset(s_warn_scroll).y;
      break;
    case RecognizerEvent_Cancelled:
      scroll_layer_set_content_offset(s_warn_scroll, GPoint(0, s_warn_pan_base), true);
      break;
    default:
      break;
  }
}
#endif

static int warn_item_count(void) {
  return g_weather.warn_count > 0 ? g_weather.warn_count : 1;
}

static void warn_item_at(int i, int *type, const char **title, const char **body) {
  if (i >= 0 && i < g_weather.warn_count) {
    *type = g_weather.warnings[i].type > 0 ? g_weather.warnings[i].type : WARN_OTHER;
    *title = g_weather.warnings[i].title[0] ? g_weather.warnings[i].title : "Warning";
    *body = g_weather.warnings[i].body[0] ? g_weather.warnings[i].body : "";
    return;
  }
  *type = WARN_OTHER;
  *title = g_weather.warn_title[0] ? g_weather.warn_title : "Warning";
  *body = g_weather.warn_full[0] ? g_weather.warn_full : g_weather.warn_sub;
}

static int warn_content_height(int width) {
  GFont title_font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  GFont body_font = fonts_get_system_font(FONT_KEY_GOTHIC_18);
  int y = 8;
  int n = warn_item_count();
  for (int i = 0; i < n; i++) {
    int type;
    const char *title;
    const char *body;
    warn_item_at(i, &type, &title, &body);
    y += WARN_ICON_S + 8;
    GSize ts = graphics_text_layout_get_content_size(
        title, title_font, GRect(0, 0, width, 160),
        GTextOverflowModeWordWrap, GTextAlignmentLeft);
    y += ts.h + 2;
    if (body && body[0]) {
      GSize bs = graphics_text_layout_get_content_size(
          body, body_font, GRect(0, 0, width, 2000),
          GTextOverflowModeWordWrap, GTextAlignmentLeft);
      y += bs.h;
    }
    y += 16;
  }
  return y + 8;
}

static void fill_tri(GContext *ctx, GPoint a, GPoint b, GPoint c) {
  GPoint pts[3] = {a, b, c};
  GPathInfo info = { .num_points = 3, .points = pts };
  GPath *path = gpath_create(&info);
  graphics_context_set_fill_color(ctx, theme_fg());
  gpath_draw_filled(ctx, path);
  gpath_destroy(path);
}

static void warn_scroll_limits(int *off_y, int *min_y) {
  GRect frame = layer_get_bounds(scroll_layer_get_layer(s_warn_scroll));
  GSize content = scroll_layer_get_content_size(s_warn_scroll);
  int min = frame.size.h - content.h;
  if (min > 0) {
    min = 0;
  }
  *off_y = scroll_layer_get_content_offset(s_warn_scroll).y;
  *min_y = min;
}

static void warn_hint_update(Layer *layer, GContext *ctx) {
  if (!s_warn_scroll) {
    return;
  }
  int off_y;
  int min_y;
  warn_scroll_limits(&off_y, &min_y);
  GRect bounds = layer_get_bounds(layer);
  int cx = bounds.size.w - PBL_IF_ROUND_ELSE(22, 10);
  if (off_y < 0) {
    int y = PBL_IF_ROUND_ELSE(26, 14);
    fill_tri(ctx, GPoint(cx, y - 4), GPoint(cx - 5, y + 5), GPoint(cx + 5, y + 5));
  }
  if (off_y > min_y) {
    int y = bounds.size.h - PBL_IF_ROUND_ELSE(26, 14);
    fill_tri(ctx, GPoint(cx, y + 4), GPoint(cx - 5, y - 5), GPoint(cx + 5, y - 5));
  }
}

static void warn_offset_changed(ScrollLayer *scroll, void *ctx) {
  (void)scroll;
  (void)ctx;
  if (s_warn_hint) {
    layer_mark_dirty(s_warn_hint);
  }
}

static void warn_canvas_update(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  int width = bounds.size.w;
  GFont title_font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  GFont body_font = fonts_get_system_font(FONT_KEY_GOTHIC_18);
  int y = 8;
  int n = warn_item_count();
  graphics_context_set_text_color(ctx, theme_fg());
  for (int i = 0; i < n; i++) {
    int type;
    const char *title;
    const char *body;
    warn_item_at(i, &type, &title, &body);
    warn_icon_draw(ctx, GRect((width - WARN_ICON_S) / 2, y, WARN_ICON_S, WARN_ICON_S), type);
    y += WARN_ICON_S + 8;
    GSize ts = graphics_text_layout_get_content_size(
        title, title_font, GRect(0, 0, width, 160),
        GTextOverflowModeWordWrap, GTextAlignmentLeft);
    graphics_draw_text(ctx, title, title_font, GRect(0, y, width, ts.h + 4),
                       GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
    y += ts.h + 2;
    if (body && body[0]) {
      GSize bs = graphics_text_layout_get_content_size(
          body, body_font, GRect(0, 0, width, 2000),
          GTextOverflowModeWordWrap, GTextAlignmentLeft);
      graphics_draw_text(ctx, body, body_font, GRect(0, y, width, bs.h + 4),
                         GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
      y += bs.h;
    }
    y += 16;
  }
}

static void toast_hide(void *data) {
  (void)data;
  s_toast_timer = NULL;
  if (s_toast) {
    layer_set_hidden(text_layer_get_layer(s_toast), true);
  }
}

void forecast_menu_toast(const char *text) {
  if (!text || !text[0]) {
    return;
  }
  strncpy(s_toast_text, text, sizeof(s_toast_text) - 1);
  s_toast_text[sizeof(s_toast_text) - 1] = '\0';
  if (!s_toast) {
    return;
  }
  text_layer_set_text(s_toast, s_toast_text);
  layer_set_hidden(text_layer_get_layer(s_toast), false);
  if (s_toast_timer) {
    app_timer_cancel(s_toast_timer);
  }
  s_toast_timer = app_timer_register(2800, toast_hide, NULL);
}

static void warn_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  s_warn_scroll = scroll_layer_create(bounds);
  const int pad = PBL_IF_ROUND_ELSE(18, 8);
  int inner_w = bounds.size.w - pad * 2;
  int content_h = warn_content_height(inner_w);
  if (content_h < bounds.size.h) {
    content_h = bounds.size.h;
  }
  s_warn_canvas = layer_create(GRect(pad, 0, inner_w, content_h));
  layer_set_update_proc(s_warn_canvas, warn_canvas_update);
  scroll_layer_add_child(s_warn_scroll, s_warn_canvas);
  scroll_layer_set_content_size(s_warn_scroll, GSize(bounds.size.w, content_h));
  scroll_layer_set_callbacks(s_warn_scroll, (ScrollLayerCallbacks){
    .content_offset_changed_handler = warn_offset_changed,
  });
  scroll_layer_set_click_config_onto_window(s_warn_scroll, window);
  layer_add_child(root, scroll_layer_get_layer(s_warn_scroll));
  s_warn_hint = layer_create(bounds);
  layer_set_update_proc(s_warn_hint, warn_hint_update);
  layer_add_child(root, s_warn_hint);
#if defined(PBL_TOUCH)
  window_set_touch_bridge_disabled(window, true);
  Recognizer *pan = pan_recognizer_create(warn_pan_touch, NULL, PanAxis_Vertical);
  window_attach_recognizer(window, pan);
#endif
}

static void warn_window_unload(Window *window) {
  (void)window;
  layer_destroy(s_warn_hint);
  layer_destroy(s_warn_canvas);
  scroll_layer_destroy(s_warn_scroll);
  s_warn_hint = NULL;
  s_warn_canvas = NULL;
  s_warn_scroll = NULL;
}

static void show_warning(void) {
  if (!s_warn_window) {
    s_warn_window = window_create();
    window_set_window_handlers(s_warn_window, (WindowHandlers){
      .load = warn_window_load,
      .unload = warn_window_unload,
    });
    window_set_background_color(s_warn_window, theme_bg());
  }
  window_stack_push(s_warn_window, true);
}

static void select_click(MenuLayer *layer, MenuIndex *index, void *ctx) {
  (void)layer;
  (void)ctx;
  if (is_radar_row(index)) {
    radar_show();
    return;
  }
  if (is_warn_row(index)) {
    show_warning();
    return;
  }
  if (is_now_row(index)) {
    day_detail_show(DETAIL_CURRENT);
    return;
  }
  if (g_weather.day_count == 0) {
    weather_request(REQUEST_FORECAST, 0);
    return;
  }
  int day_i = day_index_for_row(index->row);
  if (day_i >= 0 && day_i < g_weather.day_count) {
    day_detail_show(day_i);
  }
}

static void apply_menu_theme(void) {
  if (!s_menu) {
    return;
  }
  menu_layer_set_normal_colors(s_menu, theme_bg(), theme_fg());
  menu_layer_set_highlight_colors(s_menu, theme_hi_bg(), theme_hi_fg());
}

static void window_load(Window *window) {
  (void)window;
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);

  s_menu = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_menu, NULL, (MenuLayerCallbacks){
    .get_num_sections = get_num_sections,
    .get_num_rows = get_num_rows,
    .get_header_height = get_header_height,
    .get_cell_height = get_cell_height,
    .draw_header = draw_header,
    .draw_row = draw_row,
    .select_click = select_click,
  });
  menu_layer_set_click_config_onto_window(s_menu, window);
#ifdef PBL_ROUND
  menu_layer_set_center_focused(s_menu, true);
#endif
  apply_menu_theme();
  layer_add_child(root, menu_layer_get_layer(s_menu));

  s_toast = text_layer_create(GRect(PBL_IF_ROUND_ELSE(18, 8),
                                    bounds.size.h - PBL_IF_ROUND_ELSE(40, 28),
                                    bounds.size.w - PBL_IF_ROUND_ELSE(36, 16),
                                    PBL_IF_ROUND_ELSE(36, 24)));
  text_layer_set_font(s_toast, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD));
  text_layer_set_text_alignment(s_toast, GTextAlignmentCenter);
  text_layer_set_text_color(s_toast, GColorBlack);
#ifdef PBL_COLOR
  text_layer_set_background_color(s_toast, GColorChromeYellow);
#else
  text_layer_set_background_color(s_toast, GColorWhite);
#endif
  text_layer_set_text(s_toast, s_toast_text);
  layer_add_child(root, text_layer_get_layer(s_toast));
  layer_set_hidden(text_layer_get_layer(s_toast), s_toast_text[0] == '\0');
  if (s_toast_text[0]) {
    if (s_toast_timer) {
      app_timer_cancel(s_toast_timer);
    }
    s_toast_timer = app_timer_register(2800, toast_hide, NULL);
  }
}

static void window_unload(Window *window) {
  (void)window;
  if (s_toast_timer) {
    app_timer_cancel(s_toast_timer);
    s_toast_timer = NULL;
  }
  text_layer_destroy(s_toast);
  s_toast = NULL;
  menu_layer_destroy(s_menu);
  s_menu = NULL;
}

void forecast_menu_init(void) {
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .unload = window_unload,
  });
  window_set_background_color(s_window, theme_bg());
}

void forecast_menu_deinit(void) {
  if (s_warn_window) {
    window_destroy(s_warn_window);
    s_warn_window = NULL;
  }
  window_destroy(s_window);
}

void forecast_menu_show(void) {
  window_stack_push(s_window, true);
}

void forecast_menu_reload(void) {
  if (s_window) {
    window_set_background_color(s_window, theme_bg());
  }
  if (s_warn_window) {
    window_set_background_color(s_warn_window, theme_bg());
  }
  apply_menu_theme();
  if (s_menu) {
    menu_layer_reload_data(s_menu);
  }
  if (s_warn_canvas) {
    layer_mark_dirty(s_warn_canvas);
  }
  if (s_warn_hint) {
    layer_mark_dirty(s_warn_hint);
  }
}
