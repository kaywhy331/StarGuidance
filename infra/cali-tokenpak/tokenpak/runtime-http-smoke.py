"""Exercise TokenPak's configured DLP block at its real HTTP boundary."""

import json
import urllib.error
import urllib.request
from pathlib import Path


proxy_token = Path("/run/secrets/tokenpak_proxy_auth_token").read_text().strip()
payload = json.dumps(
    {
        "model": "openai/gpt-oss-120b",
        "messages": [
            {"role": "system", "content": "Return one JSON object."},
            {
                "role": "user",
                "content": "Synthetic DLP probe: synthetic-dlp@example.invalid",
            },
        ],
        "stream": False,
    }
).encode()
request = urllib.request.Request(
    "http://127.0.0.1:8766/v1/chat/completions",
    data=payload,
    method="POST",
    headers={
        "Authorization": f"Bearer {proxy_token}",
        "Content-Type": "application/json",
        "Host": "groq-egress:8080",
    },
)

try:
    urllib.request.urlopen(request, timeout=5)
except urllib.error.HTTPError as error:
    assert error.code == 403
    body = json.loads(error.read())
    assert body["error"]["type"] == "dlp_block"
    assert "email" in body["error"]["rule_ids"]
    assert "synthetic-dlp@example.invalid" not in json.dumps(body)
else:
    raise AssertionError("DLP probe was forwarded instead of blocked")
