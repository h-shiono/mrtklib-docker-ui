#!/bin/sh
# Drop root and run the app as PUID:PGID (default 1000:1000).
#
# Started as root, this creates the runtime user, hands it /workspace and a
# writable working directory, grants access to mapped serial devices, then
# re-execs the command through gosu. PUID=0 keeps running as root. Started
# as a non-root user (compose `user:`), it just runs the command.
set -eu

APP_USER=mrtk
STATE_DIR=/var/lib/mrtklib-web-ui   # cwd: mrtk writes rtkrcv.nav and *.trace here

if [ "$(id -u)" != "0" ]; then
    exec "$@"
fi

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$PUID" = "0" ]; then
    mkdir -p "$STATE_DIR"
    cd "$STATE_DIR"
    exec "$@"
fi

if ! getent group "$PGID" >/dev/null; then
    groupadd -g "$PGID" "$APP_USER"
fi
if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd -o -u "$PUID" -g "$PGID" -d "/home/$APP_USER" -m -s /usr/sbin/nologin "$APP_USER"
fi
HOME_DIR="/home/$APP_USER"

# Serial access (RT inputs, CLAS pipeline): dialout, plus the owning group
# of every mapped tty in case the host uses another gid.
usermod -aG dialout "$APP_USER"
for dev in /dev/ttyUSB* /dev/ttyACM* /dev/ttyS* /dev/serial/by-id/*; do
    [ -e "$dev" ] || continue
    gid="$(stat -Lc %g "$dev")"
    # Never join group root; a root-group device must be opened via its mode
    if [ "$gid" = "0" ]; then
        echo "entrypoint: $dev is group root; not adding $APP_USER to it" >&2
        continue
    fi
    getent group "$gid" >/dev/null || groupadd -g "$gid" "tty$gid"
    usermod -aG "$(getent group "$gid" | cut -d: -f1)" "$APP_USER"
done

# A .netrc mounted at the old root location keeps working
if [ -f /root/.netrc ] && [ ! -e "$HOME_DIR/.netrc" ]; then
    install -m 600 -o "$PUID" -g "$PGID" /root/.netrc "$HOME_DIR/.netrc"
fi

# Files written by earlier root-run versions become the user's
mkdir -p /workspace "$STATE_DIR"
chown "$PUID:$PGID" /workspace "$STATE_DIR"
find /workspace -xdev \( ! -user "$PUID" -o ! -group "$PGID" \) \
    -exec chown -h "$PUID:$PGID" {} + 2>/dev/null || true

cd "$STATE_DIR"
exec gosu "$APP_USER" "$@"
