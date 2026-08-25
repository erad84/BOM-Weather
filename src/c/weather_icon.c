#include "weather_icon.h"
#include "weather.h"
#include <string.h>

static void fill_circle(GContext *ctx, int x, int y, int r) {
  graphics_fill_circle(ctx, GPoint(x, y), r);
}

static void line(GContext *ctx, int x1, int y1, int x2, int y2) {
  graphics_draw_line(ctx, GPoint(x1, y1), GPoint(x2, y2));
}

static GColor ink(void) {
#ifdef PBL_COLOR
  return theme_is_light() ? GColorDarkGray : GColorWhite;
#else
  return theme_fg();
#endif
}

static void draw_sun(GContext *ctx, int cx, int cy, int r, bool rays) {
#ifdef PBL_COLOR
  graphics_context_set_fill_color(ctx, GColorChromeYellow);
  graphics_context_set_stroke_color(ctx, GColorChromeYellow);
#else
  graphics_context_set_fill_color(ctx, ink());
  graphics_context_set_stroke_color(ctx, ink());
#endif
  graphics_context_set_stroke_width(ctx, 2);
  fill_circle(ctx, cx, cy, r);
  if (!rays) {
    return;
  }
  int reach = r + (r > 6 ? 5 : 3);
  line(ctx, cx, cy - reach, cx, cy - r - 1);
  line(ctx, cx, cy + r + 1, cx, cy + reach);
  line(ctx, cx - reach, cy, cx - r - 1, cy);
  line(ctx, cx + r + 1, cy, cx + reach, cy);
  int d = (reach * 7) / 10;
  line(ctx, cx - d, cy - d, cx - r / 2, cy - r / 2);
  line(ctx, cx + d, cy - d, cx + r / 2, cy - r / 2);
  line(ctx, cx - d, cy + d, cx - r / 2, cy + r / 2);
  line(ctx, cx + d, cy + d, cx + r / 2, cy + r / 2);
}

static void draw_cloud(GContext *ctx, int cx, int cy, int s) {
#ifdef PBL_COLOR
  graphics_context_set_fill_color(ctx, theme_is_light() ? GColorDarkGray : GColorLightGray);
#else
  graphics_context_set_fill_color(ctx, ink());
#endif
  int r = s / 5;
  fill_circle(ctx, cx - r, cy, r + 1);
  fill_circle(ctx, cx + r - 1, cy + 1, r);
  fill_circle(ctx, cx, cy - r / 2, r + 2);
  graphics_fill_rect(ctx, GRect(cx - r * 2, cy, r * 4, r + 2), 0, GCornerNone);
}

static void draw_drops(GContext *ctx, int cx, int cy, int s, int count) {
#ifdef PBL_COLOR
  graphics_context_set_stroke_color(ctx, GColorPictonBlue);
#else
  graphics_context_set_stroke_color(ctx, ink());
#endif
  graphics_context_set_stroke_width(ctx, 2);
  int len = s / 6;
  int y1 = cy + s / 6;
  int spacing = s / 5;
  int start = cx - ((count - 1) * spacing) / 2;
  for (int i = 0; i < count; i++) {
    int x = start + i * spacing;
    line(ctx, x, y1, x - 1, y1 + len);
  }
}

void weather_icon_draw(GContext *ctx, GRect box, int icon) {
  int s = box.size.w < box.size.h ? box.size.w : box.size.h;
  int cx = box.origin.x + box.size.w / 2;
  int cy = box.origin.y + box.size.h / 2;
  if (s < 16) {
    return;
  }

  switch (icon) {
    case ICON_SUNNY:
      draw_sun(ctx, cx, cy, s / 5, true);
      break;
    case ICON_PARTLY:
      draw_sun(ctx, cx - s / 6, cy - s / 6, s / 6, true);
      draw_cloud(ctx, cx + s / 10, cy + s / 10, s);
      break;
    case ICON_CLOUDY:
      draw_cloud(ctx, cx, cy, s);
      break;
    case ICON_SHOWER:
      draw_cloud(ctx, cx, cy - s / 8, s);
      draw_drops(ctx, cx, cy, s, 2);
      break;
    case ICON_RAIN:
      draw_cloud(ctx, cx, cy - s / 8, s);
      draw_drops(ctx, cx, cy, s, 3);
      break;
    case ICON_STORM:
      draw_cloud(ctx, cx, cy - s / 7, s);
#ifdef PBL_COLOR
      graphics_context_set_stroke_color(ctx, GColorChromeYellow);
#else
      graphics_context_set_stroke_color(ctx, ink());
#endif
      graphics_context_set_stroke_width(ctx, 3);
      line(ctx, cx + 2, cy - 2, cx - s / 10, cy + s / 8);
      line(ctx, cx - s / 10, cy + s / 8, cx + s / 12, cy + s / 8);
      line(ctx, cx + s / 12, cy + s / 8, cx - s / 8, cy + s / 3);
      break;
    case ICON_WIND:
#ifdef PBL_COLOR
      graphics_context_set_stroke_color(ctx, theme_is_light() ? GColorDarkGray : GColorLightGray);
#else
      graphics_context_set_stroke_color(ctx, ink());
#endif
      graphics_context_set_stroke_width(ctx, 2);
      line(ctx, cx - s / 3, cy - s / 8, cx + s / 4, cy - s / 8);
      line(ctx, cx - s / 4, cy, cx + s / 3, cy);
      line(ctx, cx - s / 3, cy + s / 8, cx + s / 5, cy + s / 8);
      break;
    case ICON_FOG:
#ifdef PBL_COLOR
      graphics_context_set_stroke_color(ctx, theme_is_light() ? GColorDarkGray : GColorLightGray);
#else
      graphics_context_set_stroke_color(ctx, ink());
#endif
      graphics_context_set_stroke_width(ctx, 2);
      line(ctx, cx - s / 3, cy - s / 6, cx + s / 3, cy - s / 6);
      line(ctx, cx - s / 4, cy, cx + s / 4, cy);
      line(ctx, cx - s / 3, cy + s / 6, cx + s / 3, cy + s / 6);
      break;
    case ICON_SNOW:
      graphics_context_set_stroke_color(ctx, ink());
      graphics_context_set_stroke_width(ctx, 2);
      line(ctx, cx, cy - s / 4, cx, cy + s / 4);
      line(ctx, cx - s / 4, cy, cx + s / 4, cy);
      line(ctx, cx - s / 6, cy - s / 6, cx + s / 6, cy + s / 6);
      line(ctx, cx + s / 6, cy - s / 6, cx - s / 6, cy + s / 6);
      break;
    default:
      draw_cloud(ctx, cx, cy, s);
      break;
  }
}

void warn_icon_draw_ink(GContext *ctx, GRect box, int type, GColor bw) {
  int s = box.size.w < box.size.h ? box.size.w : box.size.h;
  int cx = box.origin.x + box.size.w / 2;
  int cy = box.origin.y + box.size.h / 2;
  if (s < 12) {
    return;
  }
  switch (type) {
    case WARN_FIRE:
#ifdef PBL_COLOR
      graphics_context_set_fill_color(ctx, GColorOrange);
      graphics_context_set_stroke_color(ctx, GColorRed);
#else
      graphics_context_set_fill_color(ctx, bw);
      graphics_context_set_stroke_color(ctx, bw);
#endif
      graphics_fill_circle(ctx, GPoint(cx, cy + s / 8), s / 5);
      graphics_context_set_stroke_width(ctx, 2);
      line(ctx, cx, cy + s / 6, cx - s / 6, cy - s / 5);
      line(ctx, cx, cy + s / 6, cx + s / 8, cy - s / 4);
      line(ctx, cx, cy + s / 6, cx + s / 5, cy - s / 8);
      break;
    case WARN_FLOOD:
#ifdef PBL_COLOR
      graphics_context_set_fill_color(ctx, GColorPictonBlue);
      graphics_context_set_stroke_color(ctx, GColorBlue);
#else
      graphics_context_set_fill_color(ctx, bw);
      graphics_context_set_stroke_color(ctx, bw);
#endif
      graphics_fill_circle(ctx, GPoint(cx, cy - s / 8), s / 6);
      graphics_context_set_stroke_width(ctx, 2);
      line(ctx, cx - s / 3, cy + s / 8, cx - s / 8, cy + s / 4);
      line(ctx, cx - s / 8, cy + s / 4, cx + s / 8, cy + s / 8);
      line(ctx, cx + s / 8, cy + s / 8, cx + s / 3, cy + s / 4);
      break;
    case WARN_STORM:
#ifdef PBL_COLOR
      graphics_context_set_fill_color(ctx, GColorChromeYellow);
      graphics_context_set_stroke_color(ctx, GColorChromeYellow);
#else
      graphics_context_set_fill_color(ctx, bw);
      graphics_context_set_stroke_color(ctx, bw);
#endif
      graphics_context_set_stroke_width(ctx, 3);
      line(ctx, cx + s / 8, cy - s / 3, cx - s / 8, cy);
      line(ctx, cx - s / 8, cy, cx + s / 10, cy);
      line(ctx, cx + s / 10, cy, cx - s / 6, cy + s / 3);
      break;
    case WARN_MARINE:
#ifdef PBL_COLOR
      graphics_context_set_fill_color(ctx, GColorBlueMoon);
      graphics_context_set_stroke_color(ctx, theme_is_light() ? GColorBlack : GColorWhite);
#else
      graphics_context_set_fill_color(ctx, bw);
      graphics_context_set_stroke_color(ctx, bw);
#endif
      graphics_fill_rect(ctx, GRect(cx - s / 4, cy - s / 10, s / 2, s / 5), 2, GCornersAll);
      graphics_context_set_stroke_width(ctx, 2);
      line(ctx, cx, cy - s / 3, cx, cy);
      line(ctx, cx, cy - s / 4, cx + s / 5, cy - s / 12);
      break;
    default:
#ifdef PBL_COLOR
      graphics_context_set_fill_color(ctx, GColorYellow);
      graphics_context_set_stroke_color(ctx, GColorBlack);
#else
      graphics_context_set_fill_color(ctx, bw);
      graphics_context_set_stroke_color(ctx, gcolor_equal(bw, GColorWhite) ? GColorBlack : GColorWhite);
#endif
      {
        GPoint tri[3] = {
          GPoint(cx, cy - s / 3),
          GPoint(cx - s / 3, cy + s / 4),
          GPoint(cx + s / 3, cy + s / 4)
        };
        GPathInfo info = { .num_points = 3, .points = tri };
        GPath *path = gpath_create(&info);
        gpath_draw_filled(ctx, path);
        graphics_context_set_stroke_width(ctx, 2);
        gpath_draw_outline(ctx, path);
        gpath_destroy(path);
      }
#ifdef PBL_COLOR
      graphics_context_set_stroke_color(ctx, GColorBlack);
      graphics_context_set_fill_color(ctx, GColorBlack);
#else
      {
        GColor bang = gcolor_equal(bw, GColorWhite) ? GColorBlack : GColorWhite;
        graphics_context_set_stroke_color(ctx, bang);
        graphics_context_set_fill_color(ctx, bang);
      }
#endif
      graphics_context_set_stroke_width(ctx, 2);
      line(ctx, cx, cy - s / 8, cx, cy + s / 10);
      graphics_fill_circle(ctx, GPoint(cx, cy + s / 6), 1);
      break;
  }
}

static int dir_to_deg(const char *dir) {
  static const char *names[] = {
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"
  };
  if (!dir || !dir[0]) {
    return -1;
  }
  char buf[8];
  int n = 0;
  while (dir[n] && n < 7) {
    char c = dir[n];
    if (c >= 'a' && c <= 'z') {
      c = (char)(c - 32);
    }
    if (c != ' ') {
      buf[n++] = c;
    } else {
      break;
    }
  }
  buf[n] = '\0';
  for (int i = 0; i < 16; i++) {
    if (strcmp(buf, names[i]) == 0) {
      return i * 225 / 10;
    }
  }
  return -1;
}

void wind_compass_draw(GContext *ctx, GRect box, const char *dir) {
  int deg = dir_to_deg(dir);
  int s = box.size.w < box.size.h ? box.size.w : box.size.h;
  /* Odd diameter so the ring and needle share a true center pixel.
   * Stroke width 2 is even and biases down-right on Pebble. */
  if ((s % 2) == 0) {
    s--;
  }
  int cx = box.origin.x + (box.size.w - 1) / 2;
  int cy = box.origin.y + (box.size.h - 1) / 2;
  int r = s / 2;
  if (r < 5) {
    return;
  }
#ifdef PBL_COLOR
  graphics_context_set_stroke_color(ctx, theme_is_light() ? GColorDarkGray : GColorLightGray);
  graphics_context_set_fill_color(ctx, theme_is_light() ? GColorDarkGray : GColorLightGray);
#else
  graphics_context_set_stroke_color(ctx, ink());
  graphics_context_set_fill_color(ctx, ink());
#endif
  graphics_context_set_stroke_width(ctx, 1);
  graphics_draw_circle(ctx, GPoint(cx, cy), r);
  graphics_fill_circle(ctx, GPoint(cx, cy), 1);
  if (deg < 0) {
    return;
  }
  int reach = r - 2;
  int dx = (int)(reach * sin_lookup(DEG_TO_TRIGANGLE(deg)) / TRIG_MAX_RATIO);
  int dy = (int)(-reach * cos_lookup(DEG_TO_TRIGANGLE(deg)) / TRIG_MAX_RATIO);
#ifdef PBL_COLOR
  graphics_context_set_stroke_color(ctx, GColorChromeYellow);
  graphics_context_set_fill_color(ctx, GColorChromeYellow);
#else
  graphics_context_set_stroke_color(ctx, ink());
  graphics_context_set_fill_color(ctx, ink());
#endif
  graphics_context_set_stroke_width(ctx, 1);
  line(ctx, cx, cy, cx + dx, cy + dy);
  graphics_fill_circle(ctx, GPoint(cx + dx, cy + dy), 1);
}
