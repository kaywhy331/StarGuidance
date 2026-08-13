"""Send success/failure probes through the real TokenPak HTTP process."""

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path


case, action = sys.argv[1:3]
assert case in {"success", "forced-failure"}
assert action == "request"
proxy_token = Path("/run/secrets/tokenpak_proxy_auth_token").read_text().strip()
identifier = f"ci-chain-{case}-12345678"

payload = Path("/tmp/chain-payload.json").read_bytes()
request = urllib.request.Request(
    "http://127.0.0.1:8766/v1/chat/completions",
    data=payload,
    method="POST",
    headers={
        "Authorization": f"Bearer {proxy_token}",
        "Content-Type": "application/json",
        "Host": "groq-egress:8080",
        "X-Request-Id": identifier,
    },
)
try:
    response = urllib.request.urlopen(request, timeout=15)
    status = response.status
    body = json.loads(response.read())
except urllib.error.HTTPError as error:
    status = error.code
    body = json.loads(error.read())

if case == "success":
    assert status == 200
    assert body == {
        "choices": [
            {
                "finish_reason": "stop",
                "message": {"content": '{"synthetic":true}'},
            }
        ]
    }
else:
    assert status == 503
    assert body["error"]["code"] == "GROQ_REJECTED"
