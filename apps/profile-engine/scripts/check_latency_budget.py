#!/usr/bin/env python3
"""Exercise the complete profile API path against the CAL-016 latency budgets."""

from __future__ import annotations

import argparse
import json
import math
from collections.abc import Iterable
from datetime import date, timedelta
from time import perf_counter

from fastapi.testclient import TestClient

from profile_engine.main import app

UNCACHED_P95_BUDGET_MS = 4_000.0
REPEATED_P95_BUDGET_MS = 1_000.0
DEFAULT_ITERATIONS = 100
WARMUP_ITERATIONS = 10


def percentile_95(samples: list[float]) -> float:
    """Return the nearest-rank p95 for a non-empty sample."""
    if not samples:
        raise ValueError("At least one latency sample is required")
    rank = math.ceil(0.95 * len(samples))
    return sorted(samples)[rank - 1]


def synthetic_unique_payloads(iterations: int) -> Iterable[dict[str, str]]:
    """Yield deterministic, non-customer complete-profile requests."""
    first_date = date(1940, 1, 1)
    for index in range(iterations):
        yield {
            "full_birth_name": f"Synthetic Reference {index}",
            "birth_date": (first_date + timedelta(days=index * 61)).isoformat(),
            "birth_time": "08:15:00",
            "birthplace": "Test City, Example",
        }


def repeated_payload() -> dict[str, str]:
    return {
        "full_birth_name": "Synthetic Repeat Reference",
        "birth_date": "1987-07-26",
        "birth_time": "08:15:00",
        "birthplace": "Test City, Example",
    }


def measure_requests(client: TestClient, payloads: Iterable[dict[str, str]]) -> list[float]:
    samples_ms: list[float] = []
    for payload in payloads:
        started = perf_counter()
        response = client.post("/v1/profile/compute", json=payload)
        response.raise_for_status()
        samples_ms.append((perf_counter() - started) * 1_000)
    return samples_ms


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Measure synthetic profile API p95 latency. The engine intentionally has no "
            "profile-input cache; repeated requests therefore provide a conservative check "
            "against the stricter recomputation budget."
        )
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=DEFAULT_ITERATIONS,
        choices=range(20, 501),
        metavar="20..500",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repeated = repeated_payload()

    with TestClient(app) as client:
        measure_requests(client, [repeated] * WARMUP_ITERATIONS)
        uncached_samples = measure_requests(client, synthetic_unique_payloads(args.iterations))
        repeated_samples = measure_requests(client, [repeated] * args.iterations)

    uncached_p95_ms = percentile_95(uncached_samples)
    repeated_p95_ms = percentile_95(repeated_samples)
    passed = uncached_p95_ms < UNCACHED_P95_BUDGET_MS and repeated_p95_ms < REPEATED_P95_BUDGET_MS
    print(
        json.dumps(
            {
                "cacheStrategy": "none",
                "iterationsPerScenario": args.iterations,
                "passed": passed,
                "repeatedInput": {
                    "budgetMs": REPEATED_P95_BUDGET_MS,
                    "p95Ms": round(repeated_p95_ms, 3),
                },
                "uniqueInput": {
                    "budgetMs": UNCACHED_P95_BUDGET_MS,
                    "p95Ms": round(uncached_p95_ms, 3),
                },
            },
            sort_keys=True,
        )
    )
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
