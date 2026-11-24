@echo off
rem Feishu plugin shim: Agents must use the feishu_* tools; the panel checks permissions per link.
if "%FEISHU_LARK_RAW%"=="1" goto raw
if /i "%FEISHU_LARK_RAW%"=="true" goto raw
echo Feishu: use the feishu_* tools instead of lark-cli. If the user explicitly allows a raw command, prefix it with FEISHU_LARK_RAW=1. 1>&2
exit /b 126
:raw
for /f "delims=" %%i in ('where lark-cli.cmd lark-cli.exe 2^>nul') do (
  if /i not "%%~dpi"=="%~dp0" (
    call "%%i" %*
    exit /b
  )
)
echo lark-cli not found 1>&2
exit /b 127
