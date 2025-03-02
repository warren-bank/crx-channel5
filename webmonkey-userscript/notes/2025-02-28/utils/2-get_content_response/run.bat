@echo off

if [%1] == [] (
  echo Error: "content_id" is required
  exit /b 1
)

if [%2] == [] (
  echo Error: "is_live_channel" is required
  exit /b 1
)

if [%3] == [] (
  echo Error: "debug" is required
  exit /b 1
)

set content_id="%~1"
set is_live_channel="%~2"
set debug="%~3"

node "%~dp0.\index.js" %content_id% %is_live_channel% %debug%
