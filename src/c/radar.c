#include "weather.h"
#include <string.h>
#include <stdlib.h>

#if !HAS_RADAR

void radar_init(void) {}
void radar_deinit(void) {}
void radar_show(void) {}
void radar_handle_dict(DictionaryIterator *iter) {
  (void)iter;
}

#else

#ifdef PBL_BW
#define RADAR_MAX_FRAMES 4
#else
#define RADAR_MAX_FRAMES 8
#endif
#define RADAR_FRAME_MS 550
#define RADAR_LOOP_PAUSE_MS 2000
#define SYNOPTIC_FRAME_MS 1300
#define RANGE_COUNT 5
#define RANGE_NATIONAL 1

static const int k_ranges[RANGE_COUNT] = {64, 128, 256, 512, RANGE_NATIONAL};

static Window *s_window;
static BitmapLayer *s_bitmap_layer;
static TextLayer *s_header;
static TextLayer *s_status;
static GBitmap *s_bitmap;
static AppTimer *s_timer;

static uint8_t *s_frames[RADAR_MAX_FRAMES];
static uint32_t s_frame_sizes[RADAR_MAX_FRAMES];
static int s_frame_count;
static int s_current;

static uint8_t *s_recv;
static uint32_t s_recv_size;
static uint32_t s_recv_got;
static int s_recv_index;

static int s_range_idx = -1;
static int s_expect_range;
static int s_synoptic;
static Layer *s_hint;
static char s_header_text[32];
static char s_notice[MAX_NOTICE];

#if defined(PBL_PLATFORM_GABBRO)
#define HEADER_TOP 22
#define HEADER_H 24
#define HEADER_FONT FONT_KEY_GOTHIC_18_BOLD
#define STATUS_TOP 56
#elif defined(PBL_ROUND)
#define HEADER_TOP 18
#define HEADER_H 20
#define HEADER_FONT FONT_KEY_GOTHIC_14_BOLD
#define STATUS_TOP 48
#else
#define HEADER_TOP 2
#define HEADER_H 22
#define HEADER_FONT FONT_KEY_GOTHIC_18_BOLD
#define STATUS_TOP 28
#endif

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

static int index_for_range(int code) {
  for (int i = 0; i < RANGE_COUNT; i++) {
    if (k_ranges[i] == code) {
      return i;
    }
  }
  return -1;
}

static void layout_range_header(void) {
  if (!s_header || !s_window) {
    return;
  }
  GRect bounds = layer_get_bounds(window_get_root_layer(s_window));
  GFont font = fonts_get_system_font(HEADER_FONT);
  const char *text = s_header_text[0] ? s_header_text : "Radar";
  GSize sz = graphics_text_layout_get_content_size(
      text, font, GRect(0, 0, bounds.size.w, HEADER_H),
      GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft);
  int w = sz.w + 12;
  if (w < 36) {
    w = 36;
  }
  if (w > bounds.size.w - 8) {
    w = bounds.size.w - 8;
  }
  int x = (bounds.size.w - w) / 2;
  layer_set_frame(text_layer_get_layer(s_header), GRect(x, HEADER_TOP, w, HEADER_H));
}

static void set_header_from_code(int code) {
  if (code == RANGE_SYNOPTIC) {
    snprintf(s_header_text, sizeof(s_header_text), "4-day Synoptic");
  } else if (code == RANGE_NATIONAL) {
    snprintf(s_header_text, sizeof(s_header_text), "National Rain Radar");
  } else if (code == 64 || code == 128 || code == 256 || code == 512) {
    snprintf(s_header_text, sizeof(s_header_text), "%d km Rain Radar", code);
  } else {
    snprintf(s_header_text, sizeof(s_header_text), "Radar");
  }
  if (s_header) {
    text_layer_set_text(s_header, s_header_text);
    layout_range_header();
  }
  if (s_hint) {
    layer_mark_dirty(s_hint);
  }
}

static void clear_frames(void) {
  for (int i = 0; i < RADAR_MAX_FRAMES; i++) {
    if (s_frames[i]) {
      free(s_frames[i]);
      s_frames[i] = NULL;
    }
    s_frame_sizes[i] = 0;
  }
  s_frame_count = 0;
  s_current = 0;
}

static void set_status(const char *text) {
  if (!s_status) {
    return;
  }
  if (text && text[0]) {
    strncpy(s_notice, text, sizeof(s_notice) - 1);
    s_notice[sizeof(s_notice) - 1] = '\0';
    text_layer_set_text(s_status, s_notice);
    layer_set_hidden(text_layer_get_layer(s_status), false);
  } else {
    s_notice[0] = '\0';
    text_layer_set_text(s_status, "");
    layer_set_hidden(text_layer_get_layer(s_status), true);
  }
}

static void stop_timer(void) {
  if (s_timer) {
    app_timer_cancel(s_timer);
    s_timer = NULL;
  }
}

static int frame_limit(void) {
  int max = s_frame_count > 0 ? s_frame_count : RADAR_MAX_FRAMES;
  if (max > RADAR_MAX_FRAMES) {
    max = RADAR_MAX_FRAMES;
  }
  return max;
}

static int ready_frames(void) {
  int n = 0;
  int max = frame_limit();
  for (int i = 0; i < max; i++) {
    if (s_frames[i]) {
      n++;
    }
  }
  return n;
}

static int last_ready_index(void) {
  int last = -1;
  int max = frame_limit();
  for (int i = 0; i < max; i++) {
    if (s_frames[i]) {
      last = i;
    }
  }
  return last;
}

static void show_frame(int index) {
  if (index < 0 || index >= RADAR_MAX_FRAMES || !s_frames[index]) {
    return;
  }
  if (s_bitmap_layer) {
    bitmap_layer_set_bitmap(s_bitmap_layer, NULL);
  }
  if (s_bitmap) {
    gbitmap_destroy(s_bitmap);
    s_bitmap = NULL;
  }
  s_bitmap = gbitmap_create_from_png_data(s_frames[index], s_frame_sizes[index]);
  if (s_bitmap && s_bitmap_layer) {
    bitmap_layer_set_bitmap(s_bitmap_layer, s_bitmap);
    layer_mark_dirty(bitmap_layer_get_layer(s_bitmap_layer));
    set_status("");
  }
}

static void timer_cb(void *data) {
  (void)data;
  s_timer = NULL;
  int count = frame_limit();
  if (count < 2) {
    return;
  }
  int next = s_current;
  int found = 0;
  for (int n = 0; n < count; n++) {
    next = (next + 1) % count;
    if (s_frames[next]) {
      found = 1;
      break;
    }
  }
  if (found) {
    s_current = next;
    show_frame(s_current);
  }
  if (ready_frames() >= 2) {
    int delay = s_synoptic ? SYNOPTIC_FRAME_MS : RADAR_FRAME_MS;
    if (s_current == last_ready_index()) {
      delay = RADAR_LOOP_PAUSE_MS;
    }
    s_timer = app_timer_register(delay, timer_cb, NULL);
  }
}

static void begin_load(int extra) {
  stop_timer();
  clear_frames();
  if (s_bitmap) {
    gbitmap_destroy(s_bitmap);
    s_bitmap = NULL;
  }
  if (s_bitmap_layer) {
    bitmap_layer_set_bitmap(s_bitmap_layer, NULL);
  }
  if (s_recv) {
    free(s_recv);
    s_recv = NULL;
  }
  s_synoptic = 0;
  set_status("Loading radar...");
  weather_request(REQUEST_RADAR, extra);
  if (s_hint) {
    layer_mark_dirty(s_hint);
  }
}

static void begin_synoptic(void) {
  stop_timer();
  clear_frames();
  if (s_bitmap) {
    gbitmap_destroy(s_bitmap);
    s_bitmap = NULL;
  }
  if (s_bitmap_layer) {
    bitmap_layer_set_bitmap(s_bitmap_layer, NULL);
  }
  if (s_recv) {
    free(s_recv);
    s_recv = NULL;
  }
  s_synoptic = 1;
  s_expect_range = RANGE_SYNOPTIC;
  set_header_from_code(RANGE_SYNOPTIC);
  set_status("Loading synoptic...");
  weather_request(REQUEST_SYNOPTIC, 0);
  if (s_hint) {
    layer_mark_dirty(s_hint);
  }
}

static void toggle_synoptic(void) {
  if (s_synoptic) {
    int extra = (s_range_idx >= 0) ? k_ranges[s_range_idx] : 0;
    s_expect_range = extra;
    set_header_from_code(extra);
    begin_load(extra);
  } else {
    begin_synoptic();
  }
}

static void step_range(int dir) {
  if (s_synoptic || s_range_idx < 0) {
    return;
  }
  int next = s_range_idx + dir;
  if (next < 0 || next >= RANGE_COUNT) {
    return;
  }
  s_range_idx = next;
  s_expect_range = k_ranges[s_range_idx];
  set_header_from_code(s_expect_range);
  begin_load(s_expect_range);
}

static void go_back(void) {
  stop_timer();
  window_stack_pop(true);
}

static void up_click(ClickRecognizerRef rec, void *ctx) {
  (void)rec;
  (void)ctx;
  step_range(1);
}

static void down_click(ClickRecognizerRef rec, void *ctx) {
  (void)rec;
  (void)ctx;
  step_range(-1);
}

static void back_click(ClickRecognizerRef rec, void *ctx) {
  (void)rec;
  (void)ctx;
  go_back();
}

static void select_click(ClickRecognizerRef rec, void *ctx) {
  (void)rec;
  (void)ctx;
  toggle_synoptic();
}

static void fill_tri(GContext *ctx, GPoint a, GPoint b, GPoint c) {
  GPoint pts[3] = {a, b, c};
  GPathInfo info = { .num_points = 3, .points = pts };
  GPath *path = gpath_create(&info);
  graphics_context_set_fill_color(ctx, GColorBlack);
  gpath_draw_filled(ctx, path);
  gpath_destroy(path);
}

static void hint_update(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  int cx = bounds.size.w - PBL_IF_ROUND_ELSE(22, 10);
  int cy = bounds.size.h / 2;
  if (s_synoptic) {
    fill_tri(ctx, GPoint(cx + 3, cy - 6), GPoint(cx + 3, cy + 6), GPoint(cx - 5, cy));
  } else {
    int up_y = PBL_IF_ROUND_ELSE(26, 14);
    int down_y = bounds.size.h - PBL_IF_ROUND_ELSE(26, 14);
    fill_tri(ctx, GPoint(cx, up_y - 4), GPoint(cx - 5, up_y + 5), GPoint(cx + 5, up_y + 5));
    fill_tri(ctx, GPoint(cx, down_y + 4), GPoint(cx - 5, down_y - 5), GPoint(cx + 5, down_y - 5));
    fill_tri(ctx, GPoint(cx - 5, cy - 6), GPoint(cx - 5, cy + 6), GPoint(cx + 3, cy));
  }
}

#if defined(PBL_TOUCH)
static void swipe_touch(const Recognizer *recognizer, RecognizerEvent event) {
  if (event != RecognizerEvent_Completed) {
    return;
  }
  SwipeDirection dir = swipe_recognizer_get_direction(recognizer);
  if (dir == SwipeDirection_Up) {
    step_range(1);
  } else if (dir == SwipeDirection_Down) {
    step_range(-1);
  } else if (dir == SwipeDirection_Left || dir == SwipeDirection_Right) {
    go_back();
  }
}

static void attach_touch(Window *window) {
  window_set_touch_bridge_disabled(window, true);
  Recognizer *swipe = swipe_recognizer_create(
      swipe_touch, NULL,
      (uint8_t)(SwipeDirection_Up | SwipeDirection_Down | SwipeDirection_Left |
                SwipeDirection_Right));
  window_attach_recognizer(window, swipe);
}
#endif

static void click_config(void *ctx) {
  (void)ctx;
  window_single_click_subscribe(BUTTON_ID_UP, up_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
  window_single_click_subscribe(BUTTON_ID_BACK, back_click);
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);

  s_bitmap_layer = bitmap_layer_create(bounds);
  bitmap_layer_set_alignment(s_bitmap_layer, GAlignCenter);
#ifdef PBL_COLOR
  bitmap_layer_set_background_color(s_bitmap_layer, GColorBlack);
#endif
  layer_add_child(root, bitmap_layer_get_layer(s_bitmap_layer));

  s_header = text_layer_create(GRect(0, HEADER_TOP, 48, HEADER_H));
  text_layer_set_font(s_header, fonts_get_system_font(HEADER_FONT));
  text_layer_set_text_alignment(s_header, GTextAlignmentCenter);
#ifdef PBL_COLOR
  text_layer_set_text_color(s_header, GColorWhite);
  text_layer_set_background_color(s_header, GColorBlack);
#endif
  text_layer_set_text(s_header, s_header_text);
  layer_add_child(root, text_layer_get_layer(s_header));
  layout_range_header();

  const int status_h = 88;
  s_status = text_layer_create(GRect(PBL_IF_ROUND_ELSE(18, 8), STATUS_TOP,
                                     bounds.size.w - PBL_IF_ROUND_ELSE(36, 16),
                                     status_h));
  text_layer_set_font(s_status, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_status, GTextAlignmentCenter);
  text_layer_set_overflow_mode(s_status, GTextOverflowModeWordWrap);
#ifdef PBL_COLOR
  text_layer_set_text_color(s_status, GColorWhite);
  text_layer_set_background_color(s_status, GColorClear);
#endif
  layer_add_child(root, text_layer_get_layer(s_status));
  set_status("Loading radar...");

  s_hint = layer_create(bounds);
  layer_set_update_proc(s_hint, hint_update);
  layer_add_child(root, s_hint);

  window_set_click_config_provider(window, click_config);
#if defined(PBL_TOUCH)
  attach_touch(window);
#endif
}

static void window_unload(Window *window) {
  (void)window;
  stop_timer();
  if (s_bitmap) {
    gbitmap_destroy(s_bitmap);
    s_bitmap = NULL;
  }
  bitmap_layer_destroy(s_bitmap_layer);
  text_layer_destroy(s_header);
  text_layer_destroy(s_status);
  if (s_hint) {
    layer_destroy(s_hint);
    s_hint = NULL;
  }
  s_bitmap_layer = NULL;
  s_header = NULL;
  s_status = NULL;
  if (s_recv) {
    free(s_recv);
    s_recv = NULL;
  }
}

static void window_appear(Window *window) {
  (void)window;
  s_range_idx = -1;
  s_expect_range = 0;
  s_synoptic = 0;
  set_header_from_code(0);
  begin_load(0);
}

void radar_init(void) {
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .appear = window_appear,
    .unload = window_unload,
  });
#ifdef PBL_COLOR
  window_set_background_color(s_window, GColorBlack);
#endif
}

void radar_deinit(void) {
  clear_frames();
  window_destroy(s_window);
}

void radar_show(void) {
  window_stack_push(s_window, true);
}

void radar_handle_dict(DictionaryIterator *iter) {
  Tuple *range_t = dict_find(iter, MESSAGE_KEY_RadarRange);
  int got_range = tuple_int(range_t, 0);
  if (s_expect_range != 0) {
    if (!range_t || got_range != s_expect_range) {
      return;
    }
  }
  if (range_t && got_range) {
    int idx = index_for_range(got_range);
    if (idx >= 0) {
      s_range_idx = idx;
    }
    s_synoptic = (got_range == RANGE_SYNOPTIC);
    set_header_from_code(got_range);
  }

  Tuple *notice_t = dict_find(iter, MESSAGE_KEY_RadarNotice);
  Tuple *count_t = dict_find(iter, MESSAGE_KEY_RadarFrameCount);
  Tuple *status_t = dict_find(iter, MESSAGE_KEY_Status);
  if (notice_t && notice_t->type == TUPLE_CSTRING && notice_t->value->cstring[0]) {
    clear_frames();
    if (s_bitmap_layer) {
      bitmap_layer_set_bitmap(s_bitmap_layer, NULL);
    }
    set_status(notice_t->value->cstring);
    return;
  }
  if (count_t && count_t->value->int32 <= 0) {
    set_status("Radar unavailable");
    return;
  }
  if (status_t && status_t->value->int32 != STATUS_OK && !dict_find(iter, MESSAGE_KEY_RadarTotalSize)) {
    if (status_t->value->int32 == STATUS_LOCATION) {
      set_status("Set location in settings");
    } else if (status_t->value->int32 == STATUS_LOADING) {
      set_status(s_synoptic ? "Loading synoptic..." : "Loading radar...");
    } else {
      set_status("Radar unavailable");
    }
  }

  Tuple *total_t = dict_find(iter, MESSAGE_KEY_RadarTotalSize);
  Tuple *index_t = dict_find(iter, MESSAGE_KEY_RadarFrameIndex);
  if (total_t && index_t) {
    if (s_recv) {
      free(s_recv);
      s_recv = NULL;
    }
    s_recv_size = (uint32_t)total_t->value->int32;
    s_recv_index = (int)index_t->value->int32;
    s_recv_got = 0;
    if (s_recv_size > 0 && s_recv_size < 90000) {
      s_recv = malloc(s_recv_size);
    }
    if (!s_recv && s_recv_size > 0) {
      set_status("Out of memory");
      return;
    }
    if (count_t) {
      s_frame_count = (int)count_t->value->int32;
      if (s_frame_count > RADAR_MAX_FRAMES) {
        s_frame_count = RADAR_MAX_FRAMES;
      }
    }
    set_status(s_synoptic ? "Loading synoptic..." : "Loading radar...");
  }

  Tuple *chunk_t = dict_find(iter, MESSAGE_KEY_RadarChunk);
  Tuple *off_t = dict_find(iter, MESSAGE_KEY_RadarOffset);
  if (chunk_t && off_t && s_recv) {
    uint32_t offset = (uint32_t)off_t->value->int32;
    uint32_t len = chunk_t->length;
    if (offset + len <= s_recv_size) {
      memcpy(s_recv + offset, chunk_t->value->data, len);
      if (offset + len > s_recv_got) {
        s_recv_got = offset + len;
      }
    }
  }

  Tuple *done_t = dict_find(iter, MESSAGE_KEY_RadarComplete);
  if (done_t && s_recv && s_recv_index >= 0 && s_recv_index < RADAR_MAX_FRAMES) {
    if (s_frames[s_recv_index]) {
      free(s_frames[s_recv_index]);
    }
    s_frames[s_recv_index] = s_recv;
    s_frame_sizes[s_recv_index] = s_recv_size;
    s_recv = NULL;
    if (s_recv_index == 0 && !s_timer) {
      show_frame(0);
    }
    if (ready_frames() >= 2 && !s_timer) {
      s_timer = app_timer_register(s_synoptic ? SYNOPTIC_FRAME_MS : RADAR_FRAME_MS, timer_cb, NULL);
    }
  }
}

#endif
