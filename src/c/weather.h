#pragma once

#include <pebble.h>

#define MAX_DAYS 7
#define MAX_DAY_NAME 24
#define MAX_DAY_TITLE 28
#define MAX_PRECIS 42
#define MAX_RAIN 22
#define MAX_UV 16
#if defined(PBL_PLATFORM_APLITE)
#define MAX_EXTENDED 220
#define MAX_COASTAL 240
#define MAX_DAY_EXTENDED 1
#define MAX_DAY_COASTAL 1
#else
#define MAX_EXTENDED 300
#define MAX_COASTAL 300
#define MAX_DAY_EXTENDED MAX_EXTENDED
#define MAX_DAY_COASTAL MAX_COASTAL
#endif
#define MAX_LOCATION 32
#define MAX_STATUS 40
#if defined(PBL_PLATFORM_APLITE)
#define MAX_WARN_TITLE 120
#define MAX_WARN_SUB 48
#define MAX_WARN_FULL 8
#define MAX_WARN_BODY 1
#define MAX_WARN_VIEW 1400
#define MAX_WARNINGS 3
#else
#define MAX_WARN_TITLE 160
#define MAX_WARN_SUB 48
#define MAX_WARN_FULL 8
#define MAX_WARN_BODY 1
#define MAX_WARN_VIEW 3600
#define MAX_WARNINGS 5
#endif
#define MAX_NOTICE 240
#define MAX_WIND 32
#define MAX_WIND_DIR 8
#define MAX_FDR 16
#define MAX_SUN 8

#define REQUEST_FORECAST 0
#define REQUEST_DETAIL 1
#define REQUEST_RADAR 2
#define REQUEST_SYNOPTIC 3
#define REQUEST_WARN_BODY 5
#define DETAIL_CURRENT -1
#define NOW_CALC_HUM 1
#define NOW_CALC_DELTA 2
#define NOW_CALC_APPARENT 4
#define NOW_CALC_DEW 8
#define NOW_CALC_MSL_NEAR 16
#define NOW_CALC_MSL_INTERP 32
#define RANGE_SYNOPTIC 2
#define RANGE_STATE 3

#define WARN_FIRE 1
#define WARN_FLOOD 2
#define WARN_STORM 3
#define WARN_MARINE 4
#define WARN_OTHER 5

#if defined(PBL_PLATFORM_APLITE)
#define HAS_RADAR 0
#else
#define HAS_RADAR 1
#endif

#if defined(PBL_PLATFORM_APLITE)
#define APPMSG_INBOX_SIZE 3200
#define APPMSG_OUTBOX_SIZE 256
#else
#define APPMSG_INBOX_SIZE 4096
#define APPMSG_OUTBOX_SIZE 256
#endif

#define STATUS_OK 0
#define STATUS_LOADING 1
#define STATUS_LOCATION 2
#define STATUS_BOM 3
#define STATUS_NOT_FOUND 4

typedef struct {
  char name[MAX_DAY_NAME];
  char title[MAX_DAY_TITLE];
  int min;
  int max;
  char precis[MAX_PRECIS];
  int rain_chance;
  char rain_amount[MAX_RAIN];
  char uv[MAX_UV];
  char fdr[MAX_FDR];
  char extended[MAX_DAY_EXTENDED];
  char coastal[MAX_DAY_COASTAL];
  int icon;
} DayForecast;

typedef struct {
  int type;
  char title[MAX_WARN_TITLE];
  char body[MAX_WARN_BODY];
} WarningItem;

typedef struct {
  char location[MAX_LOCATION];
  char status_text[MAX_STATUS];
  int status;
  int day_count;
  DayForecast days[MAX_DAYS];
  char cond_wind[MAX_WIND];
  char now_wind_dir[MAX_WIND_DIR];
  int now_temp;
  int now_hum;
  int now_delta;
  int now_apparent;
  int now_msl; /* tenths of hPa */
  int now_wind_kmh;
  int now_gust;
  int now_dew;
  char now_rain[12];
  int has_now_temp;
  int has_now_hum;
  int has_now_delta;
  int has_now_apparent;
  int has_now_msl;
  int has_now_wind_spd;
  int has_now_gust;
  int has_now_dew;
  int has_now_rain;
  int now_calc_flags;
  int has_now;
  char warn_title[MAX_WARN_TITLE];
  char warn_sub[MAX_WARN_SUB];
  char warn_full[MAX_WARN_FULL];
  WarningItem warnings[MAX_WARNINGS];
#if defined(PBL_PLATFORM_APLITE)
  char view_extended[MAX_EXTENDED];
  char view_coastal[MAX_COASTAL];
  char coastal_now[MAX_COASTAL];
  int view_detail_index;
#endif
  char warn_view_body[MAX_WARN_VIEW];
  int warn_view_index;
  int warn_count;
  int has_warn;
  int has_coastal;
  char fdr[MAX_FDR];
  char sunrise[MAX_SUN];
  char sunset[MAX_SUN];
  int cached;
} WeatherState;

extern WeatherState g_weather;

#if defined(PBL_PLATFORM_APLITE)
static inline char *weather_extended(int i) {
  (void)i;
  return g_weather.view_extended;
}
static inline size_t weather_extended_size(int i) {
  (void)i;
  return sizeof(g_weather.view_extended);
}
static inline char *weather_coastal(int i) {
  return (i <= 0) ? g_weather.coastal_now : g_weather.view_coastal;
}
static inline size_t weather_coastal_size(int i) {
  return (i <= 0) ? sizeof(g_weather.coastal_now) : sizeof(g_weather.view_coastal);
}
#else
static inline char *weather_extended(int i) {
  return g_weather.days[i].extended;
}
static inline size_t weather_extended_size(int i) {
  return sizeof(g_weather.days[i].extended);
}
static inline char *weather_coastal(int i) {
  return g_weather.days[i].coastal;
}
static inline size_t weather_coastal_size(int i) {
  return sizeof(g_weather.days[i].coastal);
}
#endif

void forecast_menu_init(void);
void forecast_menu_deinit(void);
void forecast_menu_show(void);
void forecast_menu_reload(void);
void forecast_menu_toast(const char *text);

void day_detail_init(void);
void day_detail_deinit(void);
void day_detail_show(int index);
void day_detail_reload(void);

void radar_init(void);
void radar_deinit(void);
void radar_show(void);
void radar_handle_dict(DictionaryIterator *iter);

void weather_request(int request_type, int extra);

extern int g_theme_light;
void theme_init(void);
void theme_set(int light);
int theme_is_light(void);
GColor theme_bg(void);
GColor theme_fg(void);
GColor theme_hi_bg(void);
GColor theme_hi_fg(void);
