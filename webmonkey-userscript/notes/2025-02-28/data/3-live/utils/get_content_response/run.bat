@echo off

set content_id="C5"
set is_live_channel="1"
set bat_script="%~dp0..\..\..\..\utils\2-get_content_response\run.bat"
set output_dir=%~dp0.\logs

if exist "%output_dir%" rmdir /Q /S "%output_dir%"
mkdir "%output_dir%"

call :call_bat_script 1
call :call_bat_script 2
call :call_bat_script 3
call :call_bat_script 4
goto :done

:call_bat_script
  set debug=%~1
  call %bat_script% %content_id% %is_live_channel% "%debug%" >"%output_dir%\debug-%debug%.log" 2>&1
  goto :eof

:done
