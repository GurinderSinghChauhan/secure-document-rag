import re
from uuid import uuid4

from qdrant_client import AsyncQdrantClient, models

from .config import get_settings
from .models import Principal


class VectorStore:
    def __init__(self) -> None:
        self.client = AsyncQdrantClient(url=get_settings().qdrant_url)

    @staticmethod
    def collection_name(tenant_id: str) -> str:
        return "tenant_" + re.sub(r"[^a-z0-9_]", "_", tenant_id.lower())

    async def ensure_collection(self, tenant_id: str, dimensions: int) -> str:
        collection = self.collection_name(tenant_id)
        if not await self.client.collection_exists(collection):
            await self.client.create_collection(collection, vectors_config=models.VectorParams(size=dimensions, distance=models.Distance.COSINE))
            for field_name in ("document_id", "allowed_roles", "allowed_users"):
                await self.client.create_payload_index(collection, field_name, models.PayloadSchemaType.KEYWORD, wait=True)
        return collection

    async def upsert_document(self, tenant_id: str, document_id: str, document_name: str, chunks: list[str], embeddings: list[list[float]], allowed_roles: list[str], allowed_users: list[str]) -> None:
        collection = await self.ensure_collection(tenant_id, len(embeddings[0]))
        await self.client.upsert(collection_name=collection, points=[models.PointStruct(id=str(uuid4()), vector=embedding, payload={"document_id": document_id, "document_name": document_name, "chunk_index": index, "text": chunk, "allowed_roles": allowed_roles, "allowed_users": allowed_users}) for index, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=True))])

    async def search(self, principal: Principal, embedding: list[float], limit: int) -> list[models.ScoredPoint]:
        role_match = [models.FieldCondition(key="allowed_roles", match=models.MatchAny(any=principal.roles))] if principal.roles else []
        user_match = models.FieldCondition(key="allowed_users", match=models.MatchValue(value=principal.user_id))
        access_filter = models.Filter(should=[*role_match, user_match], min_should=models.MinShould(conditions=1))
        collection = self.collection_name(principal.tenant_id)
        if not await self.client.collection_exists(collection):
            return []
        return await self.client.search(collection_name=collection, query_vector=embedding, query_filter=access_filter, limit=limit, score_threshold=get_settings().min_retrieval_score, with_payload=True)

    async def delete_document(self, tenant_id: str, document_id: str) -> None:
        collection = self.collection_name(tenant_id)
        if not await self.client.collection_exists(collection):
            return
        await self.client.delete(collection_name=collection, points_selector=models.FilterSelector(filter=models.Filter(must=[models.FieldCondition(key="document_id", match=models.MatchValue(value=document_id))])))

    async def is_ready(self) -> bool:
        try:
            await self.client.get_collections()
            return True
        except Exception:
            return False

    async def close(self) -> None:
        await self.client.close()
