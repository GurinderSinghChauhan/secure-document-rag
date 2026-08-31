import pytest
from qdrant_client import models

from app.vector_store import VectorStore


def test_acl_filter_requires_one_access_condition() -> None:
    conditions = [
        models.FieldCondition(key="allowed_roles", match=models.MatchAny(any=["admin"])),
        models.FieldCondition(key="allowed_users", match=models.MatchValue(value="user-a")),
    ]
    access_filter = models.Filter(min_should=models.MinShould(conditions=conditions, min_count=1))

    assert access_filter.min_should.min_count == 1
    assert len(access_filter.min_should.conditions) == 2


@pytest.mark.asyncio
async def test_bulk_delete_uses_one_match_any_selector() -> None:
    calls = []

    class Client:
        async def collection_exists(self, _collection):
            return True

        async def delete(self, **kwargs):
            calls.append(kwargs)

    store = VectorStore.__new__(VectorStore)
    store.client = Client()

    await store.delete_documents("organization", ["document-a", "document-b"])

    assert len(calls) == 1
    selector = calls[0]["points_selector"]
    assert selector.filter.must[0].match.any == ["document-a", "document-b"]
