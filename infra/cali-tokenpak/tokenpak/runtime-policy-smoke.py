"""Container-only assertions for the pinned TokenPak runtime policy."""

import os
from importlib.metadata import version
from pathlib import Path


egress_token = Path("/run/secrets/tokenpak_egress_token").read_text().strip()
assert len(egress_token) >= 32
os.environ["TOKENPAK_EGRESS_TOKEN"] = egress_token

from tokenpak.proxy import config
from tokenpak.proxy.router import ProviderRouter
from tokenpak.proxy.server import _inject_custom_provider_credential
from tokenpak.proxy.upstream_retry import (
    UpstreamRetryPolicy,
    persist_failed_request_metadata,
)
from tokenpak.security.dlp import DLPScanner


assert version("tokenpak") == "1.18.5"
assert config.ACTIVE_PROFILE == "safe"
for disabled in (
    "BUDGET_CONTROLLER_ENABLED",
    "CACHE_REGISTRY_ENABLED",
    "COMPRESSION_DICT_ENABLED",
    "ENABLE_CAPSULE_BUILDER",
    "ENABLE_COMPACTION",
    "FAILURE_MEMORY_ENABLED",
    "PREFIX_REGISTRY_ENABLED",
    "QUERY_EXPANSION_ENABLED",
    "QUERY_REWRITER_ENABLED",
    "REQUEST_LOGGER_ENABLED",
    "RETRIEVAL_WATCHDOG_ENABLED",
    "SEMANTIC_CACHE_ENABLED",
    "SESSION_CAPSULES_ENABLED",
    "SHADOW_ENABLED",
    "SKELETON_ENABLED",
    "STABILITY_SCORER_ENABLED",
    "STABLE_CACHE_CONTROL_AUTO",
    "TERM_RESOLVER_ENABLED",
    "TRACE_ENABLED",
    "VAULT_INJECTION_ENABLED",
):
    assert getattr(config, disabled) is False, disabled

assert config.VAULT_AUTO_REINDEX_INTERVAL == 0
assert config.VAULT_CACHE_MAX_BYTES == 0
assert config.VAULT_CACHE_PRELOAD == 0
assert str(config.MONITOR_DB) == "/proc/tokenpak-monitor-disabled.db"
assert UpstreamRetryPolicy.from_env().max_attempts == 1
assert config.CUSTOM_PROVIDER_CONFIGURED_COUNT == 1
assert config.CUSTOM_PROVIDER_REGISTERED_COUNT == 1
assert config.CUSTOM_PROVIDER_ROUTES == {
    "custom-groq-egress": "http://groq-egress:8080/openai/v1"
}
assert config.CUSTOM_PROVIDER_HOSTS == {
    "http://groq-egress:8080/openai/v1": "custom-groq-egress"
}
router = ProviderRouter(
    custom_urls=dict(config.CUSTOM_PROVIDER_ROUTES),
    custom_hosts=dict(config.CUSTOM_PROVIDER_HOSTS),
)
route_body = b'{"model":"openai/gpt-oss-120b"}'
route = router.route(
    "/v1/chat/completions",
    {
        "host": "groq-egress:8080",
        "content-length": str(len(route_body)),
    },
    route_body,
)
assert route.provider == "custom-groq-egress"
assert route.full_url == "http://groq-egress:8080/openai/v1/chat/completions"
forward_headers: dict[str, str] = {}
provider = config.REGISTERED_CUSTOM_PROVIDERS[0]
assert _inject_custom_provider_credential(forward_headers, route.full_url, provider) is True
assert forward_headers == {"Authorization": f"Bearer {egress_token}"}
assert DLPScanner().mode == "block"
assert DLPScanner().block_check("Please contact reader@example.com") is False
assert (
    persist_failed_request_metadata(
        request_id="synthetic-request",
        tip_plan_id="synthetic-plan",
        target_url="http://groq-egress:8080/openai/v1/chat/completions",
        method="POST",
        headers={"content-type": "application/json"},
        body=b'{"synthetic":true}',
        stream_started=False,
        recovery_status="terminally_failed",
        error_type="synthetic",
        error_message="synthetic",
    )
    is None
)
