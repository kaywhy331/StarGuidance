from profile_engine.models import (
    DreamspellResult,
    NineStarKiResult,
    NumerologyResult,
    ProfileTension,
    ProfileTrait,
)

TRAIT_VERSION = "profile-traits-v3"


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

NINE_STAR_LANGUAGE = {
    1: "patient observation, adaptability, and depth before commitment",
    2: "receptivity, practical care, and steady support",
    3: "initiative, quick activation, and direct expression",
    4: "flexibility, gradual influence, and connection",
    5: "consolidation, responsibility, and finding the useful center",
    6: "structure, high standards, and decisive direction",
    7: "sociability, refinement, and persuasive expression",
    8: "clear boundaries, focused stillness, and deliberate renewal",
    9: "visibility, insight, and fast-moving inspiration",
}


def synthesize_traits(
    numerology: NumerologyResult,
    dreamspell: DreamspellResult,
    nine_star_ki: NineStarKiResult,
) -> tuple[tuple[ProfileTrait, ...], tuple[ProfileTension, ...]]:
    motivation_family = _family(numerology.life_path)
    traits: tuple[ProfileTrait, ...] = (
        ProfileTrait(
            domain="coreMotivation",
            statement=FAMILY_LANGUAGE[motivation_family],
            source_system="numerology",
            source_rule=f"pythagorean.life_path.{motivation_family}",
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
    expression_family: str | None = None
    if (
        numerology.expression is not None
        and numerology.soul_urge is not None
        and numerology.personality is not None
    ):
        expression_family = _family(numerology.expression)
        name_traits = (
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
        )
        traits = (traits[0], *name_traits, traits[1])
    nine_star_traits = (
        ProfileTrait(
            domain="coreMotivation",
            statement=(
                "Your Nine Star Ki principal pattern emphasizes "
                f"{NINE_STAR_LANGUAGE[nine_star_ki.principal_star.number]}."
            ),
            source_system="nineStarKi",
            source_rule=(
                f"{nine_star_ki.interpretation_version}.principal."
                f"{nine_star_ki.principal_star.number}"
            ),
            calculation_version=nine_star_ki.algorithm_version,
            stability="uncertain",
        ),
        ProfileTrait(
            domain="emotionalProcessing",
            statement=(
                "In private or under pressure, the character pattern may emphasize "
                f"{NINE_STAR_LANGUAGE[nine_star_ki.character_star.number]}."
            ),
            source_system="nineStarKi",
            source_rule=(
                f"{nine_star_ki.interpretation_version}.character."
                f"{nine_star_ki.character_star.number}"
            ),
            calculation_version=nine_star_ki.algorithm_version,
            stability="uncertain",
        ),
        ProfileTrait(
            domain="socialOrientation",
            statement=(
                "The derived outward pattern may be experienced as "
                f"{NINE_STAR_LANGUAGE[nine_star_ki.energy_star.number]}."
            ),
            source_system="nineStarKi",
            source_rule=(
                f"{nine_star_ki.interpretation_version}.energy."
                f"{nine_star_ki.energy_star.number}"
            ),
            calculation_version=nine_star_ki.algorithm_version,
            stability="uncertain",
        ),
    )
    traits = (*traits, *nine_star_traits)

    tensions: tuple[ProfileTension, ...] = ()
    if expression_family is not None and motivation_family != expression_family:
        tensions = (
            ProfileTension(
                id="motivation-expression-tension-v1",
                side_a=traits[0].statement,
                side_b=traits[1].statement,
                trait_indexes=(0, 1),
            ),
        )
    return traits, tensions
