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
MRTK_NETRC="/home/$APP_USER/.netrc"

# True if $1 is a bind-mount target (a file mounted with -v)
is_mounted() {
    awk -v p="$1" '$5 == p { found = 1 } END { exit !found }' /proc/self/mountinfo
}

# Copy a mounted .netrc to where the app user reads it, on every start so
# host edits apply after a restart. A .netrc mounted at the destination
# itself is left alone.
sync_netrc() {  # src dst uid:gid
    if [ -f "$1" ] && is_mounted "$1" && ! is_mounted "$2"; then
        mkdir -p "$(dirname "$2")"
        install -m 600 "$1" "$2"
        chown "$3" "$2"
    fi
}

if [ "$PUID" = "0" ]; then
    # Running as root reads /root/.netrc; honour the documented mount too
    sync_netrc "$MRTK_NETRC" /root/.netrc 0:0
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
sync_netrc /root/.netrc "$MRTK_NETRC" "$PUID:$PGID"

# Files written by earlier root-run versions become the user's
mkdir -p /workspace "$STATE_DIR"
chown "$PUID:$PGID" /workspace "$STATE_DIR"
find /workspace -xdev \( ! -user "$PUID" -o ! -group "$PGID" \) \
    -exec chown -h "$PUID:$PGID" {} + 2>/dev/null || true

cd "$STATE_DIR"
exec gosu "$APP_USER" "$@"
