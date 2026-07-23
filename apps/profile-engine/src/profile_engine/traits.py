from profile_engine.models import DreamspellResult, NumerologyResult, ProfileTension, ProfileTrait

TRAIT_VERSION = "profile-traits-v1"


def _family(value: int) -> str:
    if value in {1, 5, 8}:
        return "agency"
    if value in {2, 4, 6, 22, 33}:
        return "stability"
    return "reflection"


FAMILY_LANGUAGE = {
    "agency": "You tend to regain momentum through self-directed action and tangible movement.",
    "stability": (
        "You tend to make progress through cooperation, steadiness, and dependable structure."
    ),
    "reflection": (
        "You tend to find direction through reflection, expression, and a wider point of view."
    ),
}


def synthesize_traits(
    numerology: NumerologyResult, dreamspell: DreamspellResult
) -> tuple[tuple[ProfileTrait, ...], tuple[ProfileTension, ...]]:
    motivation_family = _family(numerology.life_path)
    expression_family = _family(numerology.expression)
    traits = (
        ProfileTrait(
            domain="coreMotivation",
            statement=FAMILY_LANGUAGE[motivation_family],
            source_system="numerology",
            source_rule=f"pythagorean.life_path.{motivation_family}",
            calculation_version=numerology.algorithm_version,
            stability="stable",
        ),
        ProfileTrait(
            domain="creativeExpression",
            statement=FAMILY_LANGUAGE[expression_family],
            source_system="numerology",
            source_rule=f"pythagorean.expression.{expression_family}",
            calculation_version=numerology.algorithm_version,
            stability="stable",
        ),
        ProfileTrait(
            domain="relationshipNeeds",
            statement=FAMILY_LANGUAGE[_family(numerology.soul_urge)],
            source_system="numerology",
            source_rule=f"pythagorean.soul_urge.{_family(numerology.soul_urge)}",
            calculation_version=numerology.algorithm_version,
            stability="stable",
        ),
        ProfileTrait(
            domain="communicationStyle",
            statement=FAMILY_LANGUAGE[_family(numerology.personality)],
            source_system="numerology",
            source_rule=f"pythagorean.personality.{_family(numerology.personality)}",
            calculation_version=numerology.algorithm_version,
            stability="stable",
        ),
        ProfileTrait(
            domain="workStyle",
            statement=(
                "A rhythm of initiating, developing, integrating, and releasing may be useful to "
                "test against your lived experience."
            ),
            source_system="dreamspell",
            source_rule=f"dreamspell.tone.{dreamspell.tone}",
            calculation_version=dreamspell.algorithm_version,
            stability="uncertain",
        ),
    )
    tensions: tuple[ProfileTension, ...] = ()
    if motivation_family != expression_family:
        tensions = (
            ProfileTension(
                id="motivation-expression-tension-v1",
                side_a=traits[0].statement,
                side_b=traits[1].statement,
                trait_indexes=(0, 1),
            ),
        )
    return traits, tensions
