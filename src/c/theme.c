#include "weather.h"

#define PKEY_THEME 4

int g_theme_light;

void theme_init(void) {
  g_theme_light = persist_exists(PKEY_THEME) && persist_read_int(PKEY_THEME) ? 1 : 0;
}

void theme_set(int light) {
  g_theme_light = light ? 1 : 0;
  persist_write_int(PKEY_THEME, g_theme_light);
}

int theme_is_light(void) {
  return g_theme_light;
}

GColor theme_bg(void) {
  return g_theme_light ? GColorWhite : GColorBlack;
}

GColor theme_fg(void) {
  return g_theme_light ? GColorBlack : GColorWhite;
}

GColor theme_hi_bg(void) {
#ifdef PBL_COLOR
  return GColorIslamicGreen;
#else
  return theme_fg();
#endif
}

GColor theme_hi_fg(void) {
#ifdef PBL_COLOR
  return GColorWhite;
#else
  return theme_bg();
#endif
}
