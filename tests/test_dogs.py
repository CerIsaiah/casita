"""Dog-policy classification.

These are the cheapest tests in the suite and they guard the most
consequential field in the product: whether two large dogs can live there.

The cases below are not hypothetical. `zillow.py` used to carry a second
implementation of this taxonomy and consult it *before* `dogs.classify`, so
the looser one won. It read "pet policy: no dogs" and "no large dogs" as
`dogs_ok`, because a bare `"dogs" in value` test fired before either of its
narrower no-checks. Both are pinned here.
"""
import pytest

from casita import dogs

# (facts-grid value, expected policy)
FIELD_CASES = [
    # Bare structured answers -- prose patterns deliberately don't match these.
    ("Yes", "dogs_ok"),
    ("no", "no_dogs"),
    ("None", "no_dogs"),
    ("allowed", "dogs_ok"),
    # Prose in a field still gets read as prose.
    ("Small dogs under 25 lbs.", "small_only"),
    ("no breed restriction", "large_ok"),
    # The two that used to be wrong, in the direction that matters.
    ("pet policy: no dogs", "no_dogs"),
    ("no large dogs", "small_only"),
    # Restrictive signals beat permissive ones in the same blob.
    ("dogs ok but small dogs only", "small_only"),
]


@pytest.mark.parametrize("value,expected", FIELD_CASES)
def test_classify_field_reads_structured_and_prose_values(value, expected):
    assert dogs.classify_field(value) == expected


def test_classify_field_missing_value_returns_default():
    assert dogs.classify_field(None) is None
    assert dogs.classify_field("", default="dogs_ok") == "dogs_ok"


@pytest.mark.parametrize("policy,expected", [
    ("large_ok", True),
    ("dogs_ok", True),
    # Small-dogs-only is a "no" for this household, same as no_dogs. The
    # distinction survives in the policy so the interface can say why.
    ("small_only", False),
    ("no_dogs", False),
])
def test_allows_large_dogs_treats_size_limits_as_disqualifying(policy, expected):
    assert dogs.allows_large_dogs(policy) is expected


def test_allows_large_dogs_unknown_policy_stays_unknown():
    """"We never found out" must not collapse into "no"."""
    assert dogs.allows_large_dogs(None) is None
