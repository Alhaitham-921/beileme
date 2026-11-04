#!/bin/sh
set -eu
beileme_deploy_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
beileme_env_file="$beileme_deploy_dir/.env"
umask 077
if [ -e "$beileme_env_file" ]; then
    printf '%s\n' 'deploy/.env already exists; preserving its credentials.'
else
    command -v openssl >/dev/null 2>&1 || { printf '%s\n' 'openssl is required to generate credentials.' >&2; exit 1; }
    beileme_db_password=$(openssl rand -hex 24)
    beileme_root_password=$(openssl rand -hex 24)
    beileme_jwt_secret=$(openssl rand -hex 48)
    beileme_encryption_secret=$(openssl rand -hex 32)
    (
        set -C
        sed -e "s/^DB_PASSWORD=$/DB_PASSWORD=$beileme_db_password/" \
            -e "s/^DB_ROOT_PASSWORD=$/DB_ROOT_PASSWORD=$beileme_root_password/" \
            -e "s/^JWT_SECRET=$/JWT_SECRET=$beileme_jwt_secret/" \
            -e "s/^AI_KEY_ENCRYPTION_SECRET=$/AI_KEY_ENCRYPTION_SECRET=$beileme_encryption_secret/" \
            "$beileme_deploy_dir/.env.example" > "$beileme_env_file"
    )
    printf '%s\n' 'Created deploy/.env with independent random credentials. Values were not printed.'
fi
# Refresh the generated API environment without giving it the database root password.
beileme_api_temp=$(mktemp "$beileme_deploy_dir/.api.env.XXXXXX")
grep -v '^DB_ROOT_PASSWORD=' "$beileme_env_file" > "$beileme_api_temp"
chmod 600 "$beileme_api_temp"
mv "$beileme_api_temp" "$beileme_deploy_dir/api.env"
