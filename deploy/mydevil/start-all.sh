#!/bin/sh
# Starts both SubTracker apps after a server reboot (crontab: @reboot).
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.npm-global/bin:$PATH"

sleep 30
"$HOME/apps/subtracker/bin/start-app.sh" api
"$HOME/apps/subtracker/bin/start-app.sh" frontend
