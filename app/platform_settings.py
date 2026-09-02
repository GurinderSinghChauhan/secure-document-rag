from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from .database import PlatformSettingsRecord

PLATFORM_SETTINGS_ID = "global"


@dataclass(frozen=True)
class PlatformDisplaySettings:
    show_classification_confidence: bool = False


async def read_platform_display_settings(
    session: AsyncSession,
) -> PlatformDisplaySettings:
    record = await session.get(PlatformSettingsRecord, PLATFORM_SETTINGS_ID)
    if record is None:
        return PlatformDisplaySettings()
    return PlatformDisplaySettings(
        show_classification_confidence=bool(
            record.show_classification_confidence
        ),
    )
