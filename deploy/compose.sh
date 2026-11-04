#!/bin/sh
set -eu
beileme_deploy_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sh "$beileme_deploy_dir/init-env.sh"
cd "$beileme_deploy_dir/.."
if [ -x "$HOME/bin/docker" ]; then
    beileme_docker_bin="$HOME/bin/docker"
else
    beileme_docker_bin=docker
fi
exec "$beileme_docker_bin" compose --env-file "$beileme_deploy_dir/.env" "$@"
