#!/usr/bin/env bash
# Verifies the secrets files this config depends on exist, have sane
# permissions/ownership, and contain the expected keys — WITHOUT ever
# printing actual secret values. Run on the homeserver itself.
set -uo pipefail

pass=0
fail=0

ok()   { echo "  OK   $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL $1"; fail=$((fail+1)); }

check_perms() {
  local file="$1" expected_mode="$2" expected_owner="$3"
  local mode owner
  mode=$(stat -c '%a' "$file" 2>/dev/null)
  owner=$(stat -c '%U:%G' "$file" 2>/dev/null)
  if [ "$mode" = "$expected_mode" ]; then
    ok "permissions are $mode"
  else
    bad "permissions are $mode, expected $expected_mode (fix: chmod $expected_mode $file)"
  fi
  if [ "$owner" = "$expected_owner" ]; then
    ok "owned by $owner"
  else
    bad "owned by $owner, expected $expected_owner (fix: chown $expected_owner $file)"
  fi
}

check_keys_present() {
  local file="$1"; shift
  local present
  present=$(cut -d= -f1 "$file" 2>/dev/null)
  for key in "$@"; do
    if echo "$present" | grep -qx "$key"; then
      ok "has key $key"
    else
      bad "missing key $key"
    fi
  done
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    found=0
    for key in "$@"; do [ "$line" = "$key" ] && found=1; done
    [ "$found" = 0 ] && echo "  NOTE extra key present: $line"
  done <<< "$present"
}

section() { echo; echo "== $1 =="; }

section "/home/kryt/.smbcredentials (Samba/CIFS mount)"
f=/home/kryt/.smbcredentials
if [ -f "$f" ]; then
  check_perms "$f" 600 "kryt:kryt"
  check_keys_present "$f" username password
else
  bad "does not exist"
fi

section "/var/lib/music-info/secrets.env (Discogs + Emby API)"
f=/var/lib/music-info/secrets.env
if [ -f "$f" ]; then
  check_perms "$f" 600 "root:root"
  check_keys_present "$f" DISCOGS_TOKEN EMBY_API_KEY EMBY_BASE_URL EMBY_EXTERNAL_URL MUSIC_PATH
else
  bad "does not exist"
fi

section "/var/lib/pihole/secrets.env (Pi-hole admin password)"
f=/var/lib/pihole/secrets.env
if [ -f "$f" ]; then
  check_perms "$f" 600 "root:root"
  check_keys_present "$f" WEBPASSWORD
else
  bad "does not exist"
fi

section "/var/lib/nextcloud-admin-pass (Nextcloud admin password)"
f=/var/lib/nextcloud-admin-pass
if [ -f "$f" ]; then
  check_perms "$f" 600 "root:root"
  size=$(stat -c '%s' "$f" 2>/dev/null)
  if [ "${size:-0}" -gt 0 ]; then
    ok "non-empty ($size bytes)"
  else
    bad "file is empty"
  fi
else
  bad "does not exist"
fi

echo
echo "== Summary: $pass OK, $fail FAIL =="
[ "$fail" -eq 0 ]
