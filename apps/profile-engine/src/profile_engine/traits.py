from typing import Literal

from profile_engine.models import (
    DreamspellResult,
    LifeDomain,
    NineStarKiResult,
    NumerologyResult,
    ProfileConvergence,
    ProfileTension,
    ProfileTrait,
    SourceSystem,
    TraitConfidence,
    TraitDirection,
    TraitDomain,
)

TRAIT_VERSION = "profile-traits-v4"


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

NINE_STAR_FAMILY = {
    1: "reflection",
    2: "stability",
    3: "agency",
    4: "reflection",
    5: "stability",
    6: "stability",
    7: "reflection",
    8: "stability",
    9: "agency",
}

DECISION_LANGUAGE = {
    "agency": (
        "Decisions may become clearer when you name the action that is actually yours to take."
    ),
    "stability": (
        "Decisions may become clearer when you test whether the practical support around them "
        "is dependable."
    ),
    "reflection": (
        "Decisions may become clearer after you make room to examine more than one interpretation."
    ),
}

RISK_LANGUAGE = {
    "agency": (
        "Momentum can be useful, but a reversible first step may reveal what urgency overlooks."
    ),
    "stability": (
        "You may prefer risks whose commitments, support, and exit conditions are visible in "
        "advance."
    ),
    "reflection": (
        "You may engage risk more comfortably after gathering context and naming what remains "
        "unknown."
    ),
}

CHANGE_LANGUAGE = {
    "agency": "Change may feel workable when it creates room for initiative and visible movement.",
    "stability": "Change may feel workable when continuity and reliable structure travel with it.",
    "reflection": (
        "Change may feel workable when it leaves room to revise the story as new evidence arrives."
    ),
}

GROWTH_LANGUAGE = {
    "agency": (
        "A useful growth experiment is to pair independence with one explicit check on "
        "consequences."
    ),
    "stability": (
        "A useful growth experiment is to change one dependable routine without removing its "
        "support."
    ),
    "reflection": (
        "A useful growth experiment is to turn one insight into a small observable action."
    ),
}

CONFLICT_LANGUAGE = {
    "agency": (
        "In conflict, directness may help most when it also leaves the other person room to answer."
    ),
    "stability": (
        "In conflict, naming the shared structure you want to preserve may reduce avoidable "
        "uncertainty."
    ),
    "reflection": (
        "In conflict, pausing to distinguish observation from interpretation may improve "
        "communication."
    ),
}


def _trait(
    *,
    domain: TraitDomain,
    statement: str,
    source_system: SourceSystem,
    source_rule: str,
    calculation_version: str,
    stability: Literal["stable", "uncertain", "unavailable"],
    direction: TraitDirection,
    strength: float,
    confidence: TraitConfidence,
    life_domains: tuple[LifeDomain, ...],
) -> ProfileTrait:
    return ProfileTrait(
        domain=domain,
        statement=statement,
        source_system=source_system,
        source_rule=source_rule,
        calculation_version=calculation_version,
        stability=stability,
        direction=direction,
        strength=strength,
        confidence=confidence,
        life_domains=life_domains,
    )


def synthesize_traits(
    numerology: NumerologyResult,
    dreamspell: DreamspellResult,
    nine_star_ki: NineStarKiResult,
) -> tuple[
    tuple[ProfileTrait, ...],
    tuple[ProfileTension, ...],
    tuple[ProfileConvergence, ...],
]:
    motivation_family = _family(numerology.life_path)
    traits: list[ProfileTrait] = [
        _trait(
            domain="coreMotivation",
            statement=FAMILY_LANGUAGE[motivation_family],
            source_system="numerology",
            source_rule=f"pythagorean.life_path.{motivation_family}",
            calculation_version=numerology.algorithm_version,
            stability="stable",
            direction="supportive",
            strength=0.9,
            confidence="high",
            life_domains=("general", "career", "change"),
        ),
        _trait(
            domain="decisionStyle",
            statement=DECISION_LANGUAGE[motivation_family],
            source_system="numerology",
            source_rule=f"pythagorean.life_path.decision.{motivation_family}",
            calculation_version=numerology.algorithm_version,
            stability="stable",
            direction="supportive",
            strength=0.8,
            confidence="high",
            life_domains=("general", "career", "change"),
        ),
        _trait(
            domain="riskOrientation",
            statement=RISK_LANGUAGE[_family(numerology.birthday)],
            source_system="numerology",
            source_rule=f"pythagorean.birthday.risk.{_family(numerology.birthday)}",
            calculation_version=numerology.algorithm_version,
            stability="stable",
            direction="mixed",
            strength=0.7,
            confidence="medium",
            life_domains=("career", "change"),
        ),
        _trait(
            domain="stabilityVsChange",
            statement=CHANGE_LANGUAGE[motivation_family],
            source_system="numerology",
            source_rule=f"pythagorean.life_path.change.{motivation_family}",
            calculation_version=numerology.algorithm_version,
            stability="stable",
            direction="mixed",
            strength=0.75,
            confidence="high",
            life_domains=("change",),
        ),
        _trait(
            domain="growthLever",
            statement=GROWTH_LANGUAGE[motivation_family],
            source_system="numerology",
            source_rule=f"pythagorean.life_path.growth.{motivation_family}",
            calculation_version=numerology.algorithm_version,
            stability="stable",
            direction="supportive",
            strength=0.75,
            confidence="medium",
            life_domains=("general", "change"),
        ),
    ]
    expression_family: str | None = None
    expression_index: int | None = None
    if (
        numerology.expression is not None
        and numerology.soul_urge is not None
        and numerology.personality is not None
    ):
        expression_family = _family(numerology.expression)
        expression_index = len(traits)
        traits.extend(
            [
                _trait(
                    domain="creativeExpression",
                    statement=FAMILY_LANGUAGE[expression_family],
                    source_system="numerology",
                    source_rule=f"pythagorean.expression.{expression_family}",
                    calculation_version=numerology.algorithm_version,
                    stability="stable",
                    direction="supportive",
                    strength=0.8,
                    confidence="high",
                    life_domains=("creativity", "career"),
                ),
                _trait(
                    domain="relationshipNeeds",
                    statement=FAMILY_LANGUAGE[_family(numerology.soul_urge)],
                    source_system="numerology",
                    source_rule=f"pythagorean.soul_urge.{_family(numerology.soul_urge)}",
                    calculation_version=numerology.algorithm_version,
                    stability="stable",
                    direction="supportive",
                    strength=0.8,
                    confidence="high",
                    life_domains=("relationships",),
                ),
                _trait(
                    domain="communicationStyle",
                    statement=FAMILY_LANGUAGE[_family(numerology.personality)],
                    source_system="numerology",
                    source_rule=f"pythagorean.personality.{_family(numerology.personality)}",
                    calculation_version=numerology.algorithm_version,
                    stability="stable",
                    direction="mixed",
                    strength=0.75,
                    confidence="high",
                    life_domains=("relationships", "career"),
                ),
                _trait(
                    domain="conflictResponse",
                    statement=CONFLICT_LANGUAGE[_family(numerology.personality)],
                    source_system="numerology",
                    source_rule=f"pythagorean.personality.conflict.{_family(numerology.personality)}",
                    calculation_version=numerology.algorithm_version,
                    stability="stable",
                    direction="mixed",
                    strength=0.7,
                    confidence="medium",
                    life_domains=("relationships",),
                ),
            ]
        )

    tensions: list[ProfileTension] = []
    if (
        expression_family is not None
        and expression_index is not None
        and motivation_family != expression_family
    ):
        tensions.append(
            ProfileTension(
                id="motivation-expression-tension-v2",
                side_a=traits[0].statement,
                side_b=traits[expression_index].statement,
                trait_indexes=(0, expression_index),
                life_domains=("general", "career", "change", "creativity"),
            )
        )
        traits.append(
            _trait(
                domain="repeatingTension",
                statement=(
                    "A recurring choice may involve honoring both your underlying source of "
                    "momentum and the way you prefer to express it."
                ),
                source_system="numerology",
                source_rule="pythagorean.life_path_expression.tension.v2",
                calculation_version=numerology.algorithm_version,
                stability="stable",
                direction="challenging",
                strength=0.8,
                confidence="medium",
                life_domains=("general", "career", "change", "creativity"),
            )
        )

    traits.append(
        _trait(
            domain="workStyle",
            statement=(
                "A rhythm of initiating, developing, integrating, and releasing may be useful to "
                "test against your lived experience."
            ),
            source_system="dreamspell",
            source_rule=f"dreamspell.tone.{dreamspell.tone}",
            calculation_version=dreamspell.algorithm_version,
            stability="uncertain",
            direction="mixed",
            strength=0.4,
            confidence="low",
            life_domains=("career", "creativity"),
        ),
    )
    principal_index = len(traits)
    traits.extend(
        [
            _trait(
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
                direction="mixed",
                strength=0.4,
                confidence="low",
                life_domains=("general", "change"),
            ),
            _trait(
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
                direction="mixed",
                strength=0.35,
                confidence="low",
                life_domains=("relationships", "general"),
            ),
            _trait(
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
                direction="mixed",
                strength=0.35,
                confidence="low",
                life_domains=("relationships", "career"),
            ),
        ]
    )

    convergences: list[ProfileConvergence] = []
    if motivation_family == NINE_STAR_FAMILY[nine_star_ki.principal_star.number]:
        convergences.append(
            ProfileConvergence(
                id=f"core-motivation-{motivation_family}-v1",
                domain="coreMotivation",
                summary=(
                    "Two independently represented systems point toward the same broad "
                    f"{motivation_family} orientation; treat that as a reflection prompt, "
                    "not proof."
                ),
                trait_indexes=(0, principal_index),
                source_systems=("numerology", "nineStarKi"),
                confidence="low",
            ),
        )
    return tuple(traits), tuple(tensions), tuple(convergences)
