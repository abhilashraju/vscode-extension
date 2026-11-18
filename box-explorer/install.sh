#!/bin/sh
# Links this extension into IBM Bob IDE (same layout as the Gerrit extension) and registers it.
set -e
src="$(cd "$(dirname "$0")" && pwd)"
ext="$HOME/.bobide/extensions"
link="$ext/local-dev.box-explorer-1.0.0"
rm -rf "$link"
ln -s "$src" "$link"
python3 - "$ext/extensions.json" "$link" <<'PY'
import json, sys
p, link = sys.argv[1], sys.argv[2]
d = json.load(open(p))
d = [e for e in d if e['identifier']['id'] != 'local-dev.box-explorer']
d.append({"identifier": {"id": "local-dev.box-explorer"}, "version": "1.0.0",
          "location": {"$mid": 1, "path": link, "scheme": "file"},
          "relativeLocation": "local-dev.box-explorer-1.0.0"})
json.dump(d, open(p, 'w'))
PY
echo "Linked $link. Reload the Bob window."
