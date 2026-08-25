#pragma once

#include <pebble.h>
#include "weather.h"

#define ICON_UNKNOWN 0
#define ICON_SUNNY 1
#define ICON_PARTLY 2
#define ICON_CLOUDY 3
#define ICON_SHOWER 4
#define ICON_RAIN 5
#define ICON_STORM 6
#define ICON_WIND 7
#define ICON_FOG 8
#define ICON_SNOW 9

void weather_icon_draw(GContext *ctx, GRect box, int icon);
void warn_icon_draw_ink(GContext *ctx, GRect box, int type, GColor bw);
#define warn_icon_draw(ctx, box, type) warn_icon_draw_ink((ctx), (box), (type), theme_fg())
void wind_compass_draw(GContext *ctx, GRect box, const char *dir);
