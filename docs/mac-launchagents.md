# Running the server on a Mac with LaunchAgents

Two agents keep the userspace Tailscale daemon and `vibechat serve --tunnel`
running as your user, started at login and restarted if they exit. Replace
`/Users/you` with your home directory.

`~/Library/LaunchAgents/com.vibechat.tailscaled.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.vibechat.tailscaled</string>
  <key>ProgramArguments</key><array>
    <string>/opt/homebrew/bin/tailscaled</string>
    <string>--tun=userspace-networking</string>
    <string>--statedir=/Users/you/Library/Application Support/tailscaled</string>
    <string>--socket=/Users/you/Library/Application Support/tailscaled/tailscaled.sock</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/you/Library/Logs/vibechat/tailscaled.log</string>
  <key>StandardErrorPath</key><string>/Users/you/Library/Logs/vibechat/tailscaled.log</string>
</dict></plist>
```

`~/Library/LaunchAgents/com.vibechat.serve.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.vibechat.serve</string>
  <key>ProgramArguments</key><array>
    <string>/Users/you/.local/bin/vibechat</string>
    <string>serve</string>
    <string>--port</string><string>7788</string>
    <string>--data-dir</string><string>/Users/you/Library/Application Support/vibechat</string>
    <string>--tunnel</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>TAILSCALE_SOCKET</key><string>/Users/you/Library/Application Support/tailscaled/tailscaled.sock</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/you/Library/Logs/vibechat/serve.log</string>
  <key>StandardErrorPath</key><string>/Users/you/Library/Logs/vibechat/serve.log</string>
</dict></plist>
```

Load them once:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.vibechat.tailscaled.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.vibechat.serve.plist
```

Logs go to `~/Library/Logs/vibechat/`. Stop with `launchctl bootout gui/$(id -u)/com.vibechat.serve`.
The Funnel hostname is the machine's MagicDNS name; renaming the machine in
the Tailscale admin console changes every invite.
