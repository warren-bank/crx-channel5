// ==UserScript==
// @name         channel5
// @description  Improve site usability. Watch videos in external player.
// @version      1.0.2
// @match        *://*.channel5.com/*
// @icon         https://www.channel5.com/favicon.ico
// @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js
// @require      https://cdn.jsdelivr.net/gh/ricmoo/aes-js@3.1.2/index.js
// @resource     C5_PLAYER_JS     https://player.akamaized.net/html5player/core/html5-c5-player.js
// @run-at       document-end
// @grant        unsafeWindow
// @grant        GM_getResourceText
// @homepage     https://github.com/warren-bank/crx-channel5/tree/webmonkey-userscript/es5
// @supportURL   https://github.com/warren-bank/crx-channel5/issues
// @downloadURL  https://github.com/warren-bank/crx-channel5/raw/webmonkey-userscript/es5/webmonkey-userscript/channel5.user.js
// @updateURL    https://github.com/warren-bank/crx-channel5/raw/webmonkey-userscript/es5/webmonkey-userscript/channel5.user.js
// @namespace    warren-bank
// @author       Warren Bank
// @copyright    Warren Bank
// ==/UserScript==

// ----------------------------------------------------------------------------- user options

var user_options = {
  "common": {
    "debug_verbosity":              0,  // 0 = silent. 1 = console log. 2 = window alert. 3 = window alert + conditional breakpoint.
    "init_delay_ms":                5000,
    "sort_newest_first":            false
  },
  "webmonkey": {
    "post_intent_redirect_to_url":  null  // "about:blank"
  },
  "greasemonkey": {
    "redirect_to_webcast_reloaded": true,
    "force_http":                   true,
    "force_https":                  false
  }
}

// ----------------------------------------------------------------------------- constants

var constants = {
  "button_attributes": {
    "content_id":                   "x-content-id",
    "is_live_channel":              "x-is-live-channel",

    "video_url":                    "x-video-url",
    "video_type":                   "x-video-type",
    "caption_url":                  "x-caption-url",
    "referer_url":                  "x-referer-url",
    "drm_scheme":                   "x-drm-scheme",
    "drm_server":                   "x-drm-server"
  },
  "img_urls": {
    "base_webcast_reloaded_icons":  "https://github.com/warren-bank/crx-webcast-reloaded/raw/gh-pages/chrome_extension/2-release/popup/img/"
  },
  "class_names": {
    "livetv_epg_toggle_container":  "toggle-hide"
  },
  "config": {
    "APP_NAME":                     "my5desktopng",
    "BASE_URL_MEDIA":               "https://cassie.channel5.com/api/v2/media",
    "BASE_URL_LIVE_MEDIA":          "https://cassie.channel5.com/api/v2/live_media",
    "DEFAULT_JSON_HEADERS": {
      "Content-type":               "application/json",
      "Accept":                     "*/*"
    }
  }
}

var strings = {
  "button_download_video":          "Get Video URL",
  "button_start_video":             "Start Video",
  "episode_labels": {
    "season_number":                "Season #:",
    "episode_number":               "Episode #:",
    "title":                        "Title:",
    "summary":                      "Summary:",
    "duration":                     "Duration:",
    "expires":                      "Expires:",
    "video": {
      "format":                     "Format:",
      "drm":                        "DRM:"
    }
  },
  "livetv_epg_download_button":     "Download",
  "livetv_epg_toggle_button": {
    "show":                         "Show",
    "hide":                         "Hide"
  },
  "livetv_channel_labels": {
    "epg": {
      "series_title":               "Series Title:",
      "season_number":              "Season #:",
      "episode_number":             "Episode #:",
      "episode_title":              "Episode Title:",
      "episode_summary":            "Summary:",
      "duration_date_range":        "Time:",
      "duration":                   "Duration:"
    }
  }
}

// ----------------------------------------------------------------------------- state

var state = {
  keys: {
    HMAC_SECRET: null,
    AES_KEY: null
  },

  series:     {}, // {title, summary}
  episodes:   [], // [{content_id, season_number, episode_number, title, summary, duration, expires}]
  current_episode_index: -1,

  livetv_channels: [], // [{content_id, name, epg: [{series_title, season_number, episode_number, episode_title, episode_summary, duration_date_range, duration}]}]
  current_livetv_channel_index: -1
}

// ----------------------------------------------------------------------------- CSP

// add support for CSP 'Trusted Type' assignment
var add_default_trusted_type_policy = function() {
  if (typeof unsafeWindow.trustedTypes !== 'undefined') {
    try {
      var passthrough_policy = function(string) {return string}

      unsafeWindow.trustedTypes.createPolicy('default', {
          createHTML:      passthrough_policy,
          createScript:    passthrough_policy,
          createScriptURL: passthrough_policy
      })
    }
    catch(e) {}
  }
}

// ----------------------------------------------------------------------------- debug logger

var debug = function(msg, breakpoint) {
  if (!user_options.common.debug_verbosity) return

  if (msg) {
    if (typeof msg !== 'string')
      msg = JSON.stringify(msg, null, 2)

    switch(user_options.common.debug_verbosity) {
      case 1:
        console.log(msg)
        break
      case 2:
      case 3:
        unsafeWindow.alert(msg)
        break
    }
  }

  if (breakpoint && (user_options.common.debug_verbosity > 2))
    debugger;
}

// ----------------------------------------------------------------------------- helpers (xhr)

var serialize_xhr_body_object = function(data) {
  if (typeof data === 'string')
    return data

  if (!(data instanceof Object))
    return null

  var body = []
  var keys = Object.keys(data)
  var key, val
  for (var i=0; i < keys.length; i++) {
    key = keys[i]
    val = data[key]
    val = unsafeWindow.encodeURIComponent(val)

    body.push(key + '=' + val)
  }
  body = body.join('&')
  return body
}

var download_text = function(url, headers, data, withCredentials, callback) {
  if (data) {
    if (!headers)
      headers = {}
    if (!headers['content-type'])
      headers['content-type'] = 'application/x-www-form-urlencoded'

    switch(headers['content-type'].toLowerCase()) {
      case 'application/json':
        data = JSON.stringify(data)
        break

      case 'application/x-www-form-urlencoded':
      default:
        data = serialize_xhr_body_object(data)
        break
    }
  }

  var xhr    = new unsafeWindow.XMLHttpRequest()
  var method = data ? 'POST' : 'GET'

  xhr.open(method, url, true, null, null)
  xhr.withCredentials = !!withCredentials

  if (headers && (typeof headers === 'object')) {
    var keys = Object.keys(headers)
    var key, val
    for (var i=0; i < keys.length; i++) {
      key = keys[i]
      val = headers[key]
      xhr.setRequestHeader(key, val)
    }
  }

  xhr.onload = function(e) {
    if (xhr.readyState === 4) {
      if ((xhr.status >= 200) && (xhr.status < 300)) {
        callback(null, xhr.responseText)
        return
      }
    }
    callback(new Error())
  }

  xhr.onerror = function(e) {
    callback(new Error())
  }

  if (data)
    xhr.send(data)
  else
    xhr.send()
}

var download_json = function(url, headers, data, withCredentials, callback) {
  if (!headers)
    headers = {}
  if (!headers.accept)
    headers.accept = 'application/json'

  download_text(url, headers, data, withCredentials, function(error, text){
    try {
      if (error)
        callback(error)
      else
        callback(null, JSON.parse(text))
    }
    catch(e) {}
  })
}

// ----------------------------------------------------------------------------- helpers

var make_element = function(elementName, html, text) {
  var el = unsafeWindow.document.createElement(elementName)

  if (html)
    el.innerHTML = html

  if (text)
    el.textContent = text

  return el
}

var make_span = function(text) {return make_element('span', null, text)}
var make_h4   = function(text) {return make_element('h4',   null, text)}

var add_style_element = function(css) {
  if (!css) return

  var head = unsafeWindow.document.getElementsByTagName('head')[0]
  if (!head) return

  if ('function' === (typeof css))
    css = css()
  if (Array.isArray(css))
    css = css.join("\n")

  head.appendChild(
    make_element('style', null, css)
  )
}

var empty_element = function(el, html, text) {
  while (el.childNodes.length)
    el.removeChild(el.childNodes[0])

  if (html)
    el.innerHTML = html

  if (text)
    el.textContent = text

  return el
}

var append_tr = function(tr, td, colspan) {
  if (Array.isArray(td))
    tr.push('<tr><td>' + td.join('</td><td>') + '</td></tr>')
  else if ((typeof colspan === 'number') && (colspan > 1))
    tr.push('<tr><td colspan="' + colspan + '">' + td + '</td></tr>')
  else
    tr.push('<tr><td>' + td + '</td></tr>')
}

var cancel_event = function(event) {
  event.stopPropagation();event.stopImmediatePropagation();event.preventDefault();event.returnValue=false;
}

// https://stackoverflow.com/a/66696162
var convertSecondsToReadableString = function(seconds) {
  seconds = seconds || 0
  seconds = Number(seconds)
  seconds = Math.abs(seconds)

  var seconds_per_minute = 60
  var seconds_per_hour   = seconds_per_minute * 60
  var seconds_per_day    = seconds_per_hour * 24
  var seconds_per_year   = seconds_per_day * 365

  var y = Math.floor(seconds / seconds_per_year)
  var d = Math.floor((seconds % seconds_per_year) / seconds_per_day)
  var h = Math.floor((seconds % seconds_per_day)  / seconds_per_hour)
  var m = Math.floor((seconds % seconds_per_hour) / seconds_per_minute)
  var s = Math.floor( seconds % seconds_per_minute)

  var parts = []

  if (y > 0) {
    parts.push(y + ' year' + (y > 1 ? 's' : ''))
  }
  if (d > 0) {
    parts.push(d + ' day' + (d > 1 ? 's' : ''))
  }
  if (h > 0) {
    parts.push(h + ' hour' + (h > 1 ? 's' : ''))
  }
  if (m > 0) {
    parts.push(m + ' minute' + (m > 1 ? 's' : ''))
  }
  if (s > 0) {
    parts.push(s + ' second' + (s > 1 ? 's' : ''))
  }
  return parts.join(', ')
}

var convertDateRangeToReadableString = function(start_date, end_date) {
  start_date = new Date(start_date)
  end_date   = new Date(end_date)

  var parts = {
    start_date: start_date.toLocaleDateString(),
    start_time: start_date.toLocaleTimeString(),

    end_date:   end_date.toLocaleDateString(),
    end_time:   end_date.toLocaleTimeString()
  }

  var range = parts.start_date + ' ' + parts.start_time + ' - ' + ((parts.end_date !== parts.start_date) ? (parts.end_date + ' ') : '') + parts.end_time
  return range
}

// ----------------------------------------------------------------------------- URL links to tools on Webcast Reloaded website

var get_webcast_reloaded_url = function(video_data, force_http, force_https) {
  force_http  = (typeof force_http  === 'boolean') ? force_http  : user_options.greasemonkey.force_http
  force_https = (typeof force_https === 'boolean') ? force_https : user_options.greasemonkey.force_https

  var encoded_video_url, encoded_caption_url, encoded_referer_url, encoded_drm_url, webcast_reloaded_base, webcast_reloaded_url

  encoded_video_url      = encodeURIComponent(encodeURIComponent(btoa(video_data.video_url)))
  encoded_caption_url    = video_data.caption_url ? encodeURIComponent(encodeURIComponent(btoa(video_data.caption_url))) : null
  video_data.referer_url = video_data.referer_url ? video_data.referer_url : unsafeWindow.location.href
  encoded_referer_url    = encodeURIComponent(encodeURIComponent(btoa(video_data.referer_url)))
  encoded_drm_url        = (video_data.drm.scheme && video_data.drm.server) ? encodeURIComponent(encodeURIComponent(btoa(video_data.drm.scheme + '|' + video_data.drm.server))) : null

  webcast_reloaded_base = {
    "https": "https://warren-bank.github.io/crx-webcast-reloaded/external_website/index.html",
    "http":  "http://webcast-reloaded.frii.site/index.html"
  }

  webcast_reloaded_base = (force_http)
                            ? webcast_reloaded_base.http
                            : (force_https)
                               ? webcast_reloaded_base.https
                               : (video_data.video_url.toLowerCase().indexOf('http:') === 0)
                                  ? webcast_reloaded_base.http
                                  : webcast_reloaded_base.https

  webcast_reloaded_url  = webcast_reloaded_base    + '#/watch/'    + encoded_video_url
                            + (encoded_caption_url ? ('/subtitle/' + encoded_caption_url) : '')
                            + (encoded_referer_url ? ('/referer/'  + encoded_referer_url) : '')
                            + (encoded_drm_url     ? ('/drm/'      + encoded_drm_url) : '')

  return webcast_reloaded_url
}

var get_webcast_reloaded_url_chromecast_sender = function(video_data) {
  return get_webcast_reloaded_url(video_data, /* force_http= */ null, /* force_https= */ null).replace('/index.html', '/chromecast_sender.html')
}

var get_webcast_reloaded_url_airplay_sender = function(video_data) {
  return get_webcast_reloaded_url(video_data, /* force_http= */ true, /* force_https= */ false).replace('/index.html', '/airplay_sender.es5.html')
}

var get_webcast_reloaded_url_proxy = function(video_data) {
  return get_webcast_reloaded_url(video_data, /* force_http= */ true, /* force_https= */ false).replace('/index.html', '/proxy.html')
}

var get_webcast_reloaded_urls = function(video_data) {
  return {
    "index":             get_webcast_reloaded_url(                  video_data),
    "chromecast_sender": get_webcast_reloaded_url_chromecast_sender(video_data),
    "airplay_sender":    get_webcast_reloaded_url_airplay_sender(   video_data),
    "proxy":             get_webcast_reloaded_url_proxy(            video_data)
  }
}

// ----------------------------------------------------------------------------- URL handlers

var redirect_to_url = function(url) {
  if (!url) return

  if (typeof GM_loadUrl === 'function') {
    if (typeof GM_resolveUrl === 'function')
      url = GM_resolveUrl(url, unsafeWindow.location.href) || url

    GM_loadUrl(url, 'Referer', unsafeWindow.location.href)
  }
  else {
    try {
      unsafeWindow.top.location = url
    }
    catch(e) {
      unsafeWindow.window.location = url
    }
  }
}

var process_webmonkey_post_intent_redirect_to_url = function() {
  var url = null

  if (typeof user_options.webmonkey.post_intent_redirect_to_url === 'string')
    url = user_options.webmonkey.post_intent_redirect_to_url

  if (typeof user_options.webmonkey.post_intent_redirect_to_url === 'function')
    url = user_options.webmonkey.post_intent_redirect_to_url()

  if (typeof url === 'string')
    redirect_to_url(url)
}

// -----------------------------------------------------------------------------

var process_video_data = function(data) {
  if (!data.video_url) return

  if (!data.referer_url)
    data.referer_url = unsafeWindow.location.href

  if (typeof GM_startIntent === 'function') {
    // running in Android-WebMonkey: open Intent chooser

    if (!data.video_type)
      data.video_type = ''

    var args = [
      /* action = */ 'android.intent.action.VIEW',
      /* data   = */ data.video_url,
      /* type   = */ data.video_type
    ]

    // extras:
    if (data.caption_url) {
      args.push('textUrl')
      args.push(data.caption_url)
    }
    if (data.referer_url) {
      args.push('referUrl')
      args.push(data.referer_url)
    }
    if (data.drm.scheme) {
      args.push('drmScheme')
      args.push(data.drm.scheme)
    }
    if (data.drm.server) {
      args.push('drmUrl')
      args.push(data.drm.server)
    }
    if (data.drm.headers && (typeof data.drm.headers === 'object')) {
      var drm_header_keys, drm_header_key, drm_header_val

      drm_header_keys = Object.keys(data.drm.headers)
      for (var i=0; i < drm_header_keys.length; i++) {
        drm_header_key = drm_header_keys[i]
        drm_header_val = data.drm.headers[drm_header_key]

        args.push('drmHeader')
        args.push(drm_header_key + ': ' + drm_header_val)
      }
    }

    GM_startIntent.apply(this, args)
    process_webmonkey_post_intent_redirect_to_url()
    return true
  }
  else if (user_options.greasemonkey.redirect_to_webcast_reloaded) {
    // running in standard web browser: redirect URL to top-level tool on Webcast Reloaded website

    redirect_to_url(
      get_webcast_reloaded_url(data)
    )
    return true
  }
  else {
    return false
  }
}

var process_hls_data = function(data) {
  data.video_type = 'application/x-mpegurl'
  process_video_data(data)
}

var process_dash_data = function(data) {
  data.video_type = 'application/dash+xml'
  process_video_data(data)
}

// -----------------------------------------------------------------------------

var process_video_url = function(video_url, video_type, caption_url, referer_url, drm_scheme, drm_server) {
  var data = {
    video_url:   video_url   || null,
    video_type:  video_type  || null,
    caption_url: caption_url || null,
    referer_url: referer_url || null,
    drm: {
      scheme:    drm_scheme,
      server:    drm_server,
      headers:   null
    }
  }

  process_video_data(data)
}

var process_hls_url = function(hls_url, caption_url, referer_url, drm_scheme, drm_server) {
  process_video_url(/* video_url= */ hls_url, /* video_type= */ 'application/x-mpegurl', caption_url, referer_url, drm_scheme, drm_server)
}

var process_dash_url = function(dash_url, caption_url, referer_url, drm_scheme, drm_server) {
  process_video_url(/* video_url= */ dash_url, /* video_type= */ 'application/dash+xml', caption_url, referer_url, drm_scheme, drm_server)
}

// ----------------------------------------------------------------------------- API: common utilities

var retrieve_keys = function() {
  try {
    var js_code = GM_getResourceText('C5_PLAYER_JS')

    // execute script:
    unsafeWindow.document.body.appendChild(
      make_element('script', null, js_code)
    )

    // get keys:
    var dfnm = /\x72\x65\x74\x75\x72\x6e\x20\x74\x79\x70\x65\x6f\x66\x20([a-z0-9]+)\[(\d+)\]\.([a-z0-9]+)\x20\x3d\x3d\x3d\x20\x27\x66\x75\x6e\x63\x74\x69\x6f\x6e\x27/gi.exec(js_code);
    var krm = /\x27\\x68\x27:[a-z0-9]+\.[a-z0-9]+\((\d+)\),'\\x61':[a-z0-9]+\.[a-z0-9]+\((\d+)\)/gi.exec(js_code);

    state.keys.HMAC_SECRET = unsafeWindow[dfnm[1]][dfnm[2]][dfnm[3]](krm[1])
    state.keys.AES_KEY     = unsafeWindow[dfnm[1]][dfnm[2]][dfnm[3]](krm[2])
  }
  catch(e) {}
}

// ----------------------------------------------------------------------------- API: download info about VOD media items (series and films)

var download_series_media_items = function(series_id, episode_id, callback) {
  retrieve_keys()
  if (!state.keys.HMAC_SECRET || !state.keys.AES_KEY) return

  download_seasons_in_series(series_id, function(seasons) {
    if ((seasons.length === 1) && (seasons[0].numberOfEpisodes === 1) && (seasons[0].seasonNumber === null)) {
      // film
      download_film(series_id, function(film) {
        process_episodes([film])
        callback()
      })
    }
    else {
      // series
      seasons = seasons.filter(function(season) {return !!season.seasonNumber})

      download_episodes_in_every_season_of_series(series_id, episode_id, seasons, function(episodes) {
        process_episodes(episodes)
        callback()
      })
    }
  })
}

var download_seasons_in_series = function(series_id, callback) {
  download_json(
    /* url= */ 'https://corona.channel5.com/shows/' + series_id + '/seasons.json?platform=my5desktop&friendly=1',
    /* headers= */ null,
    /* data= */ null,
    /* withCredentials= */ false,
    function(error, api_data) {
      if (error) return

      if (!api_data || (typeof api_data !== 'object') || !Array.isArray(api_data.seasons) || !api_data.seasons.length) return

      api_data.seasons = api_data.seasons.filter(function(season) {return season && (typeof season === 'object') && season.numberOfEpisodes})
      if (!api_data.seasons.length) return

      callback(api_data.seasons)
    }
  )
}

var download_film = function(film_id, callback) {
  download_json(
    /* url= */ 'https://corona.channel5.com/shows/' + film_id + '/episodes/next.json?platform=my5desktop&friendly=1',
    /* headers= */ null,
    /* data= */ null,
    /* withCredentials= */ false,
    function(error, api_data) {
      if (error) return

      if (!api_data || (typeof api_data !== 'object') || !api_data.id) return

      if (!state.series.title && (api_data.title || api_data.sh_title)) {
        state.series.title = api_data.title || api_data.sh_title
      }
      if (!state.series.summary && api_data.m_desc) {
        state.series.summary = api_data.m_desc
      }

      var duration = (api_data.len)
        ? convertSecondsToReadableString(
            Math.floor(api_data.len / 1000)
          )
        : null

      var expires = (api_data.vod_e)
        ? convertSecondsToReadableString(
            Math.floor((
              (api_data.vod_e * 1000) - Date.now()
            ) / 1000)
          )
        : null

      var film = {
        content_id:     api_data.id,
        season_number:  null,
        episode_number: null,
        title:          api_data.title || api_data.sh_title,
        summary:        api_data.m_desc,
        duration:       duration,
        expires:        expires
      }

      callback(film)
    }
  )
}

var download_episodes_in_every_season_of_series = function(series_id, episode_id, seasons, callback) {
  var remaining = seasons.length
  var all_episodes = []

  var on_season_dl = function(episodes_in_season) {
    remaining -= 1

    for (var i=0; i < episodes_in_season.length; i++) {
      all_episodes.push(episodes_in_season[i])
    }

    if (remaining === 0) {
      callback(all_episodes)
    }
  }

  for (var i=0; i < seasons.length; i++) {
    download_episodes_in_one_season_of_series(series_id, episode_id, seasons[i].seasonNumber, on_season_dl)
  }
}

var download_episodes_in_one_season_of_series = function(series_id, episode_id, season_id, callback) {
  download_json(
    /* url= */ 'https://corona.channel5.com/shows/' + series_id + '/seasons/' + season_id + '/episodes.json?platform=my5desktop&friendly=1&linear=true',
    /* headers= */ null,
    /* data= */ null,
    /* withCredentials= */ false,
    function(error, api_data) {
      if (error) return

      if (!api_data || (typeof api_data !== 'object') || !Array.isArray(api_data.episodes) || !api_data.episodes.length) return

      api_data.episodes = api_data.episodes.filter(function(episodes) {return episodes && (typeof episodes === 'object') && episodes.id})
      if (!api_data.episodes.length) return

      api_data.episodes = api_data.episodes.map(function(ep_data) {
        if (!state.series.title && ep_data.sh_title) {
          state.series.title = ep_data.sh_title
        }

        var duration = (ep_data.len)
          ? convertSecondsToReadableString(
              Math.floor(ep_data.len / 1000)
            )
          : null

        var expires = (ep_data.vod_e)
          ? convertSecondsToReadableString(
              Math.floor((
                (ep_data.vod_e * 1000) - Date.now()
              ) / 1000)
            )
          : null

        var episode = {
          content_id:     ep_data.id,
          season_number:  Number(ep_data.sea_num),
          episode_number: Number(ep_data.ep_num),
          title:          ep_data.title,
          summary:        ep_data.s_desc,
          duration:       duration,
          expires:        expires,
          is_current:     (episode_id && (episode_id === ep_data.f_name))
        }

        return episode
      })

      callback(api_data.episodes)
    }
  )
}

var process_episodes = function(episodes) {
  // filter
  episodes = episodes.filter(function(episode) {return episode && episode.content_id && (episode.title || (episode.season_number && episode.episode_number))})

  // sort
  episodes.sort(function(a, b) {
    if (a.season_number !== b.season_number) {
      return (a.season_number - b.season_number)
    }
    if (a.episode_number !== b.episode_number) {
      return (a.episode_number - b.episode_number)
    }
    return a.title.localeCompare(b.title)
  })

  // reverse
  if (user_options.common.sort_newest_first)
    episodes.reverse()

  state.episodes = episodes

  if (episodes.length === 1) {
    state.current_episode_index = 0
  }
  else {
    for (var i=0; i < episodes.length; i++) {
      if (episodes[i].is_current) {
        state.current_episode_index = i
        break
      }
    }
  }
}

// ----------------------------------------------------------------------------- API: download info about live tv channels

var download_livetv_channels = function(channel_id, callback) {
  retrieve_keys()
  if (!state.keys.HMAC_SECRET || !state.keys.AES_KEY) return

  state.series = {
    title:   'Live TV Channels',
    summary: null
  }

  download_json(
    /* url= */ 'https://feeds-api.channel5.com/collections/PLC_My5FASTLiveTVPageSubNav/concise.json?vod_available=my5desktop&friendly=1',
    /* headers= */ null,
    /* data= */ null,
    /* withCredentials= */ false,
    function(error, api_data) {
      if (error) return

      if (
        !api_data || (typeof api_data !== 'object') ||
        !api_data.filters || (typeof api_data.filters !== 'object') ||
        !Array.isArray(api_data.filters.contents) || !api_data.filters.contents.length
      ) return

      api_data.filters.contents = api_data.filters.contents.filter(function(channel) {return channel && (typeof channel === 'object') && channel.live && channel.channel && channel.title})
      if (!api_data.filters.contents.length) return

      // sort
      api_data.filters.contents.sort(function(a, b) {
        return a.title.localeCompare(b.title)
      })

      state.livetv_channels = api_data.filters.contents.map(function(channel, index) {
        if (channel_id && (channel_id === channel.f_name)) {
          state.current_livetv_channel_index = index
        }

        return {
          content_id: channel.channel,
          name:       channel.title,
          epg:        null
        }
      })

      callback()
    }
  )
}

// ----------------------------------------------------------------------------- API: download EPG data for one live tv channel

var download_livetv_channel_epg = function(channel_id, callback) {
  download_json(
    /* url= */ 'https://corona.channel5.com/channels/' + channel_id + '/epg.json?platform=my5desktop&' + get_iso_range_querystring(),
    /* headers= */ null,
    /* data= */ null,
    /* withCredentials= */ false,
    function(error, api_data) {
      if (error) return

      if (!api_data || (typeof api_data !== 'object') || !Array.isArray(api_data.transmissions) || !api_data.transmissions.length) return

      api_data.transmissions = api_data.transmissions.filter(function(obj) {return obj && (typeof obj === 'object') && obj.start && obj.end && (obj.showTitle || obj.episodeTitle || (obj.seasonNumber && obj.episodeNumber))})
      if (!api_data.transmissions.length) return

      var epg = api_data.transmissions.map(function(obj) {
        var duration = convertSecondsToReadableString(
          Math.floor((
            (new Date(obj.end)).getTime() - (new Date(obj.start)).getTime()
          ) / 1000)
        )

        return {
          series_title:        obj.showTitle,
          season_number:       Number(obj.seasonNumber),
          episode_number:      Number(obj.episodeNumber),
          episode_title:       obj.episodeTitle,
          episode_summary:     obj.description,
          duration_date_range: convertDateRangeToReadableString(obj.start, obj.end),
          duration:            duration
        }
      })

      callback(epg)
    }
  )
}

var get_iso_range_querystring = function() {
  var iso_timestamp_start = get_iso_timestamp_at_previous_half_hour_increment()
  var iso_timestamp_end   = get_iso_timestamp_for_date_with_offset(iso_timestamp_start, 1, 0, 0, 0)

  var querystring = 'start=' + encodeURIComponent(iso_timestamp_start) + '&end=' + encodeURIComponent(iso_timestamp_end)
  return querystring
}

var get_iso_timestamp_at_previous_half_hour_increment = function() {
  var iso_now  = (new Date()).toISOString()
  var iso_ymdh = iso_now.substring( 0, 14)
  var iso_mins = iso_now.substring(14, 16)

  var iso_timestamp = iso_ymdh + ((parseInt(iso_mins, 10) >= 30) ? '30' : '00') + ':00.000Z'
  return iso_timestamp
}

var get_iso_timestamp_for_date_with_offset = function(date, days, hours, minutes, seconds) {
  var offset_ms = 0
  offset_ms += seconds ? (seconds             * 1000) : 0
  offset_ms += minutes ? (minutes        * 60 * 1000) : 0
  offset_ms += hours   ? (hours     * 60 * 60 * 1000) : 0
  offset_ms += days    ? (days * 24 * 60 * 60 * 1000) : 0

  date = new Date(date)
  date = date.getTime()
  date += offset_ms
  date = new Date(date)

  return date.toISOString()
}

// ----------------------------------------------------------------------------- API: download video sources for VOD (episode in series or film), or live tv channel

var download_video_sources = function(content_id, is_live_channel, callback) {
  download_json(
    /* url= */     generate_content_url(content_id, is_live_channel),
    /* headers= */ constants.config.DEFAULT_JSON_HEADERS,
    /* data= */ null,
    /* withCredentials= */ false,
    function(error, api_data) {
      if (error) return

      if (!api_data || (typeof api_data !== 'object') || !api_data.iv || !api_data.data) return

      var content = decrypt_content(api_data)
      if (!content || (typeof content !== 'object') || !Array.isArray(content.assets) || !content.assets.length) return

      content = content.assets
      content = content.filter(function(obj) {return obj && (typeof obj === 'object') && Array.isArray(obj.renditions) && obj.renditions.length})
      if (!content.length) return

      var video_sources = []
      var i, j, asset, video_type, video_data

      for (i=0; i < content.length; i++) {
        asset = content[i]

        for (j=0; j < asset.renditions.length; j++) {
          if (!asset.renditions[j].url) continue

          switch(asset.profile) {
            case 'fpshls1':
              video_type = 'application/x-mpegurl'
              break
            case 'dash4':
              video_type = 'application/dash+xml'
              break
            default:
              if (asset.profile.indexOf('hls') >= 0)
                video_type = 'application/x-mpegurl'
              else if (asset.profile.indexOf('dash') >= 0)
                video_type = 'application/dash+xml'
              else if (asset.renditions[j].url.indexOf('.m3u8') >= 0)
                video_type = 'application/x-mpegurl'
              else if (asset.renditions[j].url.indexOf('.mpd') >= 0)
                video_type = 'application/dash+xml'
              else
                video_type = ''
          }

          video_data = {
            video_url:   asset.renditions[j].url,
            video_type:  video_type,
            caption_url: null,
            referer_url: null,
            drm: {
              scheme:    asset.drm,
              server:    asset.keyserver,
              headers:   null
            }
          }

          video_sources.push(video_data)
        }
      }

      if (!video_sources.length) return

      callback(video_sources)
    }
  )
}

var generate_content_url = function(content_id, is_live_channel) {
  var timestamp = Math.floor(Date.now() / 1000)
  var c_url = (is_live_channel ? constants.config.BASE_URL_LIVE_MEDIA : constants.config.BASE_URL_MEDIA) + '/' + constants.config.APP_NAME + '/' + content_id + '.json?timestamp=' + timestamp
  var sig = CryptoJS.HmacSHA256(c_url, CryptoJS.enc.Base64.parse(state.keys.HMAC_SECRET))
  var auth = b64_std_to_url( sig.toString(CryptoJS.enc.Base64) )

  return c_url + '&auth=' + auth
}

var decrypt_content = function(content) {
  content.iv   = b64_url_to_std(content.iv)
  content.data = b64_url_to_std(content.data)

  var key_bytes  = get_bytes(state.keys.AES_KEY)
  var iv_bytes   = get_bytes(content.iv)
  var data_bytes = get_bytes(content.data)

  var aesCbc           = new aesjs.ModeOfOperation.cbc(key_bytes, iv_bytes)
  var decryptedBytes   = aesCbc.decrypt(data_bytes, false)
  var strippedBytes    = aesjs.padding.pkcs7.strip(decryptedBytes)

  var decryptedJson    = aesjs.utils.utf8.fromBytes(strippedBytes)
  var decryptedContent = JSON.parse(decryptedJson)

  return decryptedContent
}

var b64_std_to_url = function(b64) {
  return b64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

var b64_url_to_std = function(b64) {
  return b64.replace(/\u002d/g, '+').replace(/\x5f/g, '/')
}

var get_bytes = function(b64) {
  return aesjs.utils.hex.toBytes(
    CryptoJS.enc.Hex.stringify(
      CryptoJS.enc.Base64.parse(b64)
    )
  )
}

// ----------------------------------------------------------------------------- DOM: static skeleton

var reinitialize_dom = function() {
  add_default_trusted_type_policy()

  unsafeWindow.document.close()
  unsafeWindow.document.open()
  unsafeWindow.document.write('')
  unsafeWindow.document.close()

  empty_element(unsafeWindow.document.getElementsByTagName('head')[0])
  empty_element(unsafeWindow.document.body)

  add_style_element(function(){
    return [
      // --------------------------------------------------- reset

      'body {',
      '  margin: 0;',
      '  padding: 0;',
      '  font-family: serif;',
      '  font-size: 16px;',
      '  background-color: #fff !important;',
      '  overflow: auto !important;',
      '}',

      // --------------------------------------------------- declutter

      // hide: "cookie choices" modal overlay
      'body > #cassie-widget {',
      '  display: none !important;',
      '}',

      // --------------------------------------------------- series title

      'body > div > h2 {',
      '  display: block;',
      '  margin: 0;',
      '  padding: 0.5em;',
      '  font-size: 22px;',
      '  text-align: center;',
      '  background-color: #ccc;',
      '}',

      // --------------------------------------------------- series description

      'body > div > div {',
      '  padding: 0.5em;',
      '  font-size: 18px;',
      '}',

      // --------------------------------------------------- list of videos: episodes in series, or individual movie or episode

      'body > div > ul {',
      '  list-style: none;',
      '  margin: 0;',
      '  padding: 0;',
      '  padding-left: 1em;',
      '  padding-bottom: 1em;',
      '}',

      'body > div > ul > li {',
      '  list-style: none;',
      '  margin-top: 0.5em;',
      '  border-top: 1px solid #999;',
      '  padding-top: 0.5em;',
      '}',

      'body > div > ul > li > table td:first-child {',
      '  font-style: italic;',
      '  padding-right: 1em;',
      '}',

      'body > div > ul > li > blockquote {',
      '  display: block;',
      '  background-color: #eee;',
      '  padding: 0.5em 1em;',
      '  margin: 0;',
      '}',

      'body > div > ul > li > div {',
      '  margin: 0.75em 0;',
      '}',

      // --------------------------------------------------- drm

      'body > div > ul > li > div > table {',
      '  width: 100%;',
      '  border-collapse: collapse;',
      '}',

      'body > div > ul > li > div > table tr > td:first-child + td {',
      '  width: 100%;',
      '}',

      'body > div > ul > li > div > table tr > td {',
      '  border-top: 1px solid #999;',
      '  padding: 0.5em 0;',
      '}',

      'body > div > ul > li > div > table tr:first-child > td {',
      '  border-top-style: none;',
      '}',

      'body > div > ul > li > div > table button {',
      '  white-space: nowrap;',
      '}',

      'body > div > ul > li > div > table tr > td:last-child > div.icons-container {',
      '}',

      // --------------------------------------------------- links to tools on Webcast Reloaded website

      'body > div > ul > li div.icons-container {',
      '  display: block;',
      '  position: relative;',
      '  z-index: 1;',
      '  float: right;',
      '  margin: 0.5em;',
      '  width: 60px;',
      '  height: 60px;',
      '  max-height: 60px;',
      '  vertical-align: top;',
      '  background-color: #d7ecf5;',
      '  border: 1px solid #000;',
      '  border-radius: 14px;',
      '}',

      'body > div > ul > li div.icons-container > a.chromecast,',
      'body > div > ul > li div.icons-container > a.chromecast > img,',
      'body > div > ul > li div.icons-container > a.airplay,',
      'body > div > ul > li div.icons-container > a.airplay > img,',
      'body > div > ul > li div.icons-container > a.proxy,',
      'body > div > ul > li div.icons-container > a.proxy > img,',
      'body > div > ul > li div.icons-container > a.video-link,',
      'body > div > ul > li div.icons-container > a.video-link > img {',
      '  display: block;',
      '  width: 25px;',
      '  height: 25px;',
      '}',

      'body > div > ul > li div.icons-container > a.chromecast,',
      'body > div > ul > li div.icons-container > a.airplay,',
      'body > div > ul > li div.icons-container > a.proxy,',
      'body > div > ul > li div.icons-container > a.video-link {',
      '  position: absolute;',
      '  z-index: 1;',
      '  text-decoration: none;',
      '}',

      'body > div > ul > li div.icons-container > a.chromecast,',
      'body > div > ul > li div.icons-container > a.airplay {',
      '  top: 0;',
      '}',
      'body > div > ul > li div.icons-container > a.proxy,',
      'body > div > ul > li div.icons-container > a.video-link {',
      '  bottom: 0;',
      '}',

      'body > div > ul > li div.icons-container > a.chromecast,',
      'body > div > ul > li div.icons-container > a.proxy {',
      '  left: 0;',
      '}',
      'body > div > ul > li div.icons-container > a.airplay,',
      'body > div > ul > li div.icons-container > a.video-link {',
      '  right: 0;',
      '}',
      'body > div > ul > li div.icons-container > a.airplay + a.video-link {',
      '  right: 17px; /* (60 - 25)/2 to center when there is no proxy icon */',
      '}',

      // --------------------------------------------------- live tv channel

      'body > div > ul > li > blockquote + div + div > table.livetv-channel tr {',
      '  vertical-align: top;',
      '}',

      'body > div > ul > li > blockquote + div + div > table.livetv-channel tr > td {',
      '  padding: 0;',
      '}',

      'body > div > ul > li > blockquote + div + div > table.livetv-channel tr > td:first-child {',
      '  white-space: nowrap;',
      '  padding-right: 1em;',
      '}',

      'body > div > ul > li > blockquote + div + div > table.livetv-channel tr > td > h3 {',
      '  padding: 0;',
      '  margin: 0;',
      '}',

      'body > div > ul > li > blockquote + div + div > table.livetv-channel table {',
      '  width: 100%;',
      '}',

      'body > div > ul > li > blockquote + div + div > table.livetv-channel table table tr > td {',
      '  border-style: none;',
      '  padding: 0.25em 0;',
      '}',

      'body > div > ul > li > blockquote + div + div > table.livetv-channel div.livetv-epg-toggle-container {',
      '  transition: height  0.5s linear;',
      '  overflow-y: hidden !important;',
      '  height: auto !important;',
      '}',

      'body > div > ul > li > blockquote + div + div > table.livetv-channel div.livetv-epg-toggle-container.toggle-hide {',
      '  height: 0px !important;',
      '}',

      ''
    ]
  })

  var div, ul, li
  var i

  div = make_element('div')
  ul  = make_element('ul')
  div.appendChild(ul)

  if (state.series.title) {
    div.insertBefore(
      make_element('h2', null, state.series.title),
      ul
    )
  }

  if (state.series.summary) {
    div.insertBefore(
      make_element('div', null, state.series.summary),
      ul
    )
  }

  for (i=0; i < state.episodes.length; i++) {
    li = make_episode_listitem_element(
      state.episodes[i]
    )

    if (li) {
      ul.appendChild(li)

      if (i === state.current_episode_index) {
        li.querySelector(':scope button[' + constants.button_attributes.content_id + ']').click()
      }
    }
  }

  for (i=0; i < state.livetv_channels.length; i++) {
    li = make_livetv_channel_listitem_element(
      state.livetv_channels[i]
    )

    if (li) {
      ul.appendChild(li)

      if (i === state.current_livetv_channel_index) {
        li.querySelector(':scope button[' + constants.button_attributes.content_id + ']').click()
      }
    }
  }

  unsafeWindow.document.body.appendChild(div)
}

// ----------------------------------------------------------------------------- DOM: <li> for episode in show series

var make_episode_listitem_element = function(episode) {
  // const {content_id, season_number, episode_number, title, summary, duration, expires} = episode

  var tr, html, li, div_dynamic

  tr = []
  if (episode.season_number)
    append_tr(tr, [strings.episode_labels.season_number, episode.season_number])
  if (episode.episode_number)
    append_tr(tr, [strings.episode_labels.episode_number, episode.episode_number])
  if (episode.title)
    append_tr(tr, [strings.episode_labels.title, episode.title])
  if (episode.duration)
    append_tr(tr, [strings.episode_labels.duration, episode.duration])
  if (episode.expires)
    append_tr(tr, [strings.episode_labels.expires, episode.expires])
  if (episode.summary)
    append_tr(tr, strings.episode_labels.summary, 2)

  html = [
    '<table>' + tr.join("\n") + '</table>',
    '<blockquote>' + episode.summary + '</blockquote>',
    '<div></div>'
  ]

  li = make_element('li', html.join("\n"))

  div_dynamic = li.querySelector(':scope > div')
  div_dynamic.appendChild(
    make_download_video_button(episode.content_id, /* is_live_channel= */ false)
  )

  return li
}

var make_download_video_button = function(content_id, is_live_channel) {
  var button = make_element('button')

  button.setAttribute(constants.button_attributes.content_id, content_id)
  button.setAttribute(constants.button_attributes.is_live_channel, (is_live_channel ? '1' : '0'))
  button.textContent = strings.button_download_video
  button.addEventListener("click", onclick_download_video_button)

  return button
}

var onclick_download_video_button = function(event) {
  cancel_event(event)

  var button, div_dynamic, content_id, is_live_channel

  button = event.target
  if (!button) return

  div_dynamic = button.parentElement
  if (!div_dynamic) return

  content_id      =  button.getAttribute(constants.button_attributes.content_id)
  is_live_channel = (button.getAttribute(constants.button_attributes.is_live_channel) === '1')
  if (!content_id) return

  download_video_sources(content_id, is_live_channel, function(video_sources) {
    add_video_sources_to_listitem_element(div_dynamic, video_sources)
  })
}

var add_video_sources_to_listitem_element = function(div_dynamic, video_sources) {
  // video_sources is array of video_data: {video_url, video_type, caption_url, referer_url, drm: {scheme, server, headers}}

  var tr, video_data, video_summary, td_button, td_icons, div_icons, a_icons, a_icon
  var i

  tr = []
  for (i=0; i < video_sources.length; i++) {
    video_data = video_sources[i]

    video_summary  = '<ul>'
    video_summary += '  <li>' + strings.episode_labels.video.format + ' ' + video_data.video_type + '</li>'
    video_summary += '  <li>' + strings.episode_labels.video.drm    + ' ' + (video_data.drm.scheme || 'none') + '</li>'
    video_summary += '</ul>'

    append_tr(tr, ['', video_summary, '']) // col 1: button. col 3: icons.
  }
  empty_element(div_dynamic, '<table>' + tr.join("\n") + '</table>')

  tr = div_dynamic.querySelectorAll(':scope > table tr')

  for (i=0; i < tr.length; i++) {
    video_data = video_sources[i]

    td_button = tr[i].querySelector(':scope > td:first-child')
    td_icons  = tr[i].querySelector(':scope > td:last-child')

    add_start_video_button(/* block_element= */ td_button, video_data)

    if (video_data.drm.scheme) {
      div_icons = make_webcast_reloaded_div(video_data)

      a_icons = {
        real:    {},  // order: chromecast, airplay, [proxy], video-link
        ordered: []
      }

      a_icons.real.airplay    = div_icons.querySelector('a.airplay')
      a_icons.real.direct_hls = div_icons.querySelector('a.video-link')

      a_icon = a_icons.real.direct_hls.cloneNode(/* deep= */ true)
      a_icon.className = 'chromecast'
      a_icons.ordered.push(a_icon)

      a_icon = a_icons.real.direct_hls.cloneNode(/* deep= */ true)
      a_icon.className = 'airplay'
      a_icon.setAttribute('href',  video_data.drm.server)
      a_icon.setAttribute('title', 'direct link to ' + video_data.drm.scheme + ' drm server')
      a_icons.ordered.push(a_icon)

      a_icon = a_icons.real.airplay.cloneNode(/* deep= */ true)
      a_icon.className = 'video-link'
      a_icons.ordered.push(a_icon)

      empty_element(div_icons)

      for (var j=0; j < a_icons.ordered.length; j++) {
        a_icon = a_icons.ordered[j]

        div_icons.appendChild(a_icon)
      }
      a_icons = null

      td_icons.appendChild(div_icons)
    }
    else {
      insert_webcast_reloaded_div(/* block_element= */ td_icons, video_data)
    }
  }
}

var add_start_video_button = function(block_element, video_data) {
  var new_button = make_start_video_button(video_data)

  block_element.appendChild(new_button)
}

var make_start_video_button = function(video_data) {
  var button = make_element('button')

  button.setAttribute(constants.button_attributes.video_url,   video_data.video_url   || '')
  button.setAttribute(constants.button_attributes.video_type,  video_data.video_type  || '')
  button.setAttribute(constants.button_attributes.caption_url, video_data.caption_url || '')
  button.setAttribute(constants.button_attributes.referer_url, video_data.referer_url || '')
  button.setAttribute(constants.button_attributes.drm_scheme,  video_data.drm.scheme  || '')
  button.setAttribute(constants.button_attributes.drm_server,  video_data.drm.server  || '')
  button.textContent = strings.button_start_video
  button.addEventListener("click", onclick_start_video_button)

  return button
}

var onclick_start_video_button = function(event) {
  cancel_event(event)

  var button      = event.target
  var video_url   = button.getAttribute(constants.button_attributes.video_url)
  var video_type  = button.getAttribute(constants.button_attributes.video_type)
  var caption_url = button.getAttribute(constants.button_attributes.caption_url)
  var referer_url = button.getAttribute(constants.button_attributes.referer_url)
  var drm_scheme  = button.getAttribute(constants.button_attributes.drm_scheme)
  var drm_server  = button.getAttribute(constants.button_attributes.drm_server)

  if (video_url)
    process_video_url(video_url, video_type, caption_url, referer_url, drm_scheme, drm_server)
}

// -----------------------------------------------------------------------------

var insert_webcast_reloaded_div = function(block_element, video_data) {
  var webcast_reloaded_div = make_webcast_reloaded_div(video_data)

  block_element.appendChild(webcast_reloaded_div)
}

var make_webcast_reloaded_div = function(video_data) {
  var webcast_reloaded_urls = get_webcast_reloaded_urls(video_data)

  var div = make_element('div')

  var html = [
    '<a target="_blank" class="chromecast" href="' + webcast_reloaded_urls.chromecast_sender   + '" title="Chromecast Sender"><img src="'       + constants.img_urls.base_webcast_reloaded_icons + 'chromecast.png"></a>',
    '<a target="_blank" class="airplay" href="'    + webcast_reloaded_urls.airplay_sender      + '" title="ExoAirPlayer Sender"><img src="'     + constants.img_urls.base_webcast_reloaded_icons + 'airplay.png"></a>',
    '<a target="_blank" class="proxy" href="'      + webcast_reloaded_urls.proxy               + '" title="HLS-Proxy Configuration"><img src="' + constants.img_urls.base_webcast_reloaded_icons + 'proxy.png"></a>',
    '<a target="_blank" class="video-link" href="' + video_data.video_url                      + '" title="direct link to video"><img src="'    + constants.img_urls.base_webcast_reloaded_icons + 'video_link.png"></a>'
  ]

  div.setAttribute('class', 'icons-container')
  div.innerHTML = html.join("\n")

  return div
}

// ----------------------------------------------------------------------------- DOM: <li> for live tv channel

var make_livetv_channel_listitem_element = function(channel) {
  // const {content_id, name} = channel

  var html, li, div_dynamic, livetv_epg_download_button

  html = [
    '<blockquote>' + channel.name + '</blockquote>',
    '<div></div>',
    '<div>',
      '<table class="livetv-channel">',
        '<tr>',
          '<td></td>',
          '<td>',
            '<h3>EPG:</h3>',
            '<button class="livetv-epg-download-button">' + strings.livetv_epg_download_button + '</button>',
            '<div class="livetv-epg-toggle-container toggle-hide">',
            '</div>',
          '</td>',
        '</tr>',
      '</table>',
    '</div>'
  ]

  li = make_element('li', html.join("\n"))
  html = null

  div_dynamic = li.querySelector(':scope > blockquote + div')
  div_dynamic.appendChild(
    make_download_video_button(channel.content_id, /* is_live_channel= */ true)
  )

  livetv_epg_download_button = li.querySelector(':scope button.livetv-epg-download-button')
  if (livetv_epg_download_button) {
    livetv_epg_download_button.setAttribute(constants.button_attributes.content_id, channel.content_id)
    livetv_epg_download_button.addEventListener("click", onclick_livetv_epg_download_button)
  }

  return li
}

var onclick_livetv_epg_download_button = function(event) {
  cancel_event(event)

  var old_button, div_dynamic, content_id

  old_button = event.target
  if (!old_button || !old_button.classList.contains('livetv-epg-download-button')) return

  div_dynamic = old_button.nextElementSibling
  if (!div_dynamic || !div_dynamic.classList.contains('livetv-epg-toggle-container')) return

  content_id = old_button.getAttribute(constants.button_attributes.content_id)
  if (!content_id) return

  download_livetv_channel_epg(content_id, function(epg) {
    var new_button
    var tr, epg_html

    // replace download EPG button with show/hide toggle button
    new_button = make_element('button', null, strings.livetv_epg_toggle_button.hide)
    new_button.className = 'livetv-epg-toggle-button'
    new_button.addEventListener("click", onclick_livetv_epg_toggle_button)
    old_button.parentNode.replaceChild(new_button, old_button)

    // insert EPG data to DOM
    tr = []
    for (var i=0; i < epg.length; i++) {
      append_tr(
        tr,
        add_epg_to_livetv_channel_listitem_element(epg[i])
      )
    }
    epg_html = [
      '<table class="livetv-epg">',
        '<tr><td></td></tr>',
        tr.join("\n"),
      '</table>'
    ]
    empty_element(div_dynamic, epg_html.join("\n"))

    // show EPG
    div_dynamic.classList.remove(constants.class_names.livetv_epg_toggle_container)
  })
}

var onclick_livetv_epg_toggle_button = function(event) {
  cancel_event(event)

  var className = constants.class_names.livetv_epg_toggle_container
  var button, div_dynamic

  button = event.target
  if (!button) return

  div_dynamic = button.nextElementSibling
  if (!div_dynamic || !div_dynamic.classList.contains('livetv-epg-toggle-container')) return

  if (div_dynamic.classList.contains(className)) {
    // toggle: hide => show
    div_dynamic.classList.remove(className)
    button.textContent = strings.livetv_epg_toggle_button.hide
  }
  else {
    // toggle: show => hide
    div_dynamic.classList.add(className)
    button.textContent = strings.livetv_epg_toggle_button.show
  }
}

var add_epg_to_livetv_channel_listitem_element = function(epg) {
  // const {series_title, episode_title, episode_summary, duration_date_range, duration} = epg

  var tr = []
  if (epg.duration_date_range)
    append_tr(tr, [strings.livetv_channel_labels.epg.duration_date_range, epg.duration_date_range])
  if (epg.duration)
    append_tr(tr, [strings.livetv_channel_labels.epg.duration, epg.duration])
  if (epg.series_title)
    append_tr(tr, [strings.livetv_channel_labels.epg.series_title, epg.series_title])
  if (epg.season_number)
    append_tr(tr, [strings.livetv_channel_labels.epg.season_number, epg.season_number])
  if (epg.episode_number)
    append_tr(tr, [strings.livetv_channel_labels.epg.episode_number, epg.episode_number])
  if (epg.episode_title)
    append_tr(tr, [strings.livetv_channel_labels.epg.episode_title, epg.episode_title])
  if (epg.episode_summary)
    append_tr(tr, [strings.livetv_channel_labels.epg.episode_summary, epg.episode_summary])

  return '<table>' + tr.join("\n") + '</table>'
}

// ----------------------------------------------------------------------------- bootstrap

var page_init = function() {
  debug('initializing..', true)

  var path = unsafeWindow.location.pathname
  var regexs = {
    series_or_film:    new RegExp('^/show/([^/]+)/?(?:[#\\?].*)?$'),
    episode_in_series: new RegExp('^/(?:show/)?([^/]+)/season-\\d+/([^/]+)/?(?:[#\\?].*)?$'),
    livetv_channel:    new RegExp('^/channels(?:/([^/]+))?/?(?:[#\\?].*)?$')
  }
  var match, series_id, episode_id, channel_id

  match = regexs.series_or_film.exec(path)
  if (match) {
    series_id = match[1]
    download_series_media_items(series_id, episode_id, reinitialize_dom)
    return
  }

  match = regexs.episode_in_series.exec(path)
  if (match) {
    series_id  = match[1]
    episode_id = match[2]
    download_series_media_items(series_id, episode_id, reinitialize_dom)
    return
  }

  match = regexs.livetv_channel.exec(path)
  if (match) {
    channel_id = match[1]
    download_livetv_channels(channel_id, reinitialize_dom)
    return
  }
}

if (user_options.common.init_delay_ms)
  unsafeWindow.setTimeout(page_init, user_options.common.init_delay_ms)
else
  page_init()
