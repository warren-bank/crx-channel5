### [channel5](https://github.com/warren-bank/crx-channel5/tree/webmonkey-userscript/es5)

[Userscript](https://github.com/warren-bank/crx-channel5/raw/webmonkey-userscript/es5/webmonkey-userscript/channel5.user.js) for [channel5.com](https://www.channel5.com/) to run in:
* the [WebMonkey](https://github.com/warren-bank/Android-WebMonkey) application
  - for Android
* the [Tampermonkey](https://www.tampermonkey.net/) web browser extension
  - for [Firefox/Fenix](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
  - for [Chrome/Chromium](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
* the [Violentmonkey](https://violentmonkey.github.io/) web browser extension
  - for [Firefox/Fenix](https://addons.mozilla.org/firefox/addon/violentmonkey/)
  - for [Chrome/Chromium](https://chrome.google.com/webstore/detail/violent-monkey/jinjaccalgkegednnccohejagnlnfdag)

Its purpose is to:
* for on-demand video content&hellip; both series and films:
  - replace the page's content with a list of all available episodes in the series
    * where a film is treated as a series having a single episode
  - for each available episode, display:
    * title
    * summary
    * duration
    * expires
    * _Get Video URL_ button to obtain the URL for its video
  - after this button is clicked, display:
    * a list of all available video formats
  - for each available video format, display:
    * a brief summary of its attributes
    * _Start Media_ button to transfer the chosen media to an external player
    * a grouping of icons to transfer the chosen media to various pages<br>on the [Webcast-Reloaded](https://github.com/warren-bank/crx-webcast-reloaded) external [website](https://warren-bank.github.io/crx-webcast-reloaded/external_website/index.html)
      - each of these pages provide tight integration with tools for media streams:
        * _Google Chromecast_
        * [_ExoAirPlayer_](https://github.com/warren-bank/Android-ExoPlayer-AirPlay-Receiver)
        * [_HLS-Proxy_](https://github.com/warren-bank/HLS-Proxy)
* for live tv channels:
  - replace the page's content with a list of all available live tv channels
  - for each available live tv channel, display:
    * title
    * _Download EPG_ button to obtain a list of upcoming programs on this channel for the next 24 hours:
      - _Hide/Show EPG_ toggle button
      - time: start - finish
      - duration
      - series title
      - season number
      - episode number
      - episode title
      - summary
    * _Get Video URL_ button to obtain the URL for its video

### IMPORTANT:

* this userscript includes the resource: [`C5_PLAYER_JS`](https://player.akamaized.net/html5player/core/html5-c5-player.js)
* this resource serves as a local cache for a very large remote file,<br>
  so downloading isn't performed for every page load
* when this resource is updated on the server, the userscript will:
  - succeed to list episodes in series
  - fail to obtain video stream URLs;<br>
    the server will respond:
    ```js
      {"code":"4003","message":"Failed to authenticate HMAC request"}
    ```
* many userscript managers allow resources to be manually refreshed,<br>
  which will periodically be necessary to restore functionality
* for userscript managers that don't have this feature,<br>
  uninstalling and then reinstalling this userscript will have the same result

#### Notes:

* to access the data API endoint and video stream hosts:
  - a geo-fence requires that requests originate from an IP within the UK
  - login is _not_ required
  - _Referer_ request header is _not_ required

#### Credits:

* [my5-dl](https://github.com/Diazole/my5-dl) by [Sean Godsell](https://github.com/Diazole) is an _excellent_ Python script<br>that provides the methodology needed to make this project possible
  - huge thanks!

#### Legal:

* copyright: [Warren Bank](https://github.com/warren-bank)
* license: [GPL-2.0](https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt)
