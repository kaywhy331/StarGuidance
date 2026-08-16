from profile_engine.models import ProfileResponse


def test_optional_systems_publish_discriminated_activation_contracts() -> None:
    schema = ProfileResponse.model_json_schema()

    expected = {
        "WesternAstrologyResult": (
            "WesternAstrologyAvailable",
            "WesternAstrologyUnavailable",
        ),
        "BaziResult": ("BaziAvailable", "BaziUnavailable"),
        "PlanetaryAngularityResult": (
            "PlanetaryAngularityAvailable",
            "PlanetaryAngularityUnavailable",
        ),
    }
    for result_name, (available, unavailable) in expected.items():
        result_schema = schema["$defs"][result_name]
        assert result_schema["discriminator"] == {
            "mapping": {
                "available": f"#/$defs/{available}",
                "unavailable": f"#/$defs/{unavailable}",
            },
            "propertyName": "status",
        }
        assert {variant["$ref"] for variant in result_schema["oneOf"]} == {
            f"#/$defs/{available}",
            f"#/$defs/{unavailable}",
        }


def test_available_contracts_require_evidence_uncertainty_and_resolved_context() -> None:
    definitions = ProfileResponse.model_json_schema()["$defs"]

    for name in (
        "WesternAstrologyAvailable",
        "BaziAvailable",
        "PlanetaryAngularityAvailable",
    ):
        required = set(definitions[name]["required"])
        assert {"evidence", "uncertainty", "resolved_context"}.issubset(required)

    assert {
        "planetary_positions",
        "aspects",
        "angles",
        "house_systems",
    }.issubset(definitions["WesternAstrologyAvailable"]["required"])
    assert {"pillars", "conventions", "solar_term_context"}.issubset(
        definitions["BaziAvailable"]["required"]
    )
    assert {"lines", "crossings", "interpretation_policy_version"}.issubset(
        definitions["PlanetaryAngularityAvailable"]["required"]
    )
