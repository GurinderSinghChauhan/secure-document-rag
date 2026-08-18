import logging

import httpx

from .config import get_settings

logger = logging.getLogger("secure_rag.email")


async def send_account_email(to: str, subject: str, action_url: str) -> None:
    settings = get_settings()
    if settings.email_sender == "console":
        logger.warning("Development email to=%s subject=%s action_url=%s", to, subject, action_url)
        return
    if settings.email_sender != "resend" or not settings.resend_api_key:
        raise RuntimeError("Email sender is not configured")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={"from": settings.email_from_address, "to": [to], "subject": subject, "html": f'<p><a href="{action_url}">Continue securely</a></p>'},
        )
        response.raise_for_status()
