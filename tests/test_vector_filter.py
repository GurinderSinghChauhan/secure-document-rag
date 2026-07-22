from qdrant_client import models


def test_acl_filter_requires_one_access_condition() -> None:
    conditions = [
        models.FieldCondition(key="allowed_roles", match=models.MatchAny(any=["admin"])),
        models.FieldCondition(key="allowed_users", match=models.MatchValue(value="user-a")),
    ]
    access_filter = models.Filter(min_should=models.MinShould(conditions=conditions, min_count=1))

    assert access_filter.min_should.min_count == 1
    assert len(access_filter.min_should.conditions) == 2
