"""Release contracts for the static, prepared-data Vercel showcase."""

import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SHOWCASE = PROJECT_ROOT / "showcase" / "index.html"


def test_showcase_keeps_the_prepared_example_evidence_and_source_journey() -> None:
    source = SHOWCASE.read_text()

    assert 'version: "2026-08-18"' in source
    assert "preparedJourneyManifest" in source
    assert "selectJourney(journey)" in source
    assert 'player.src = journey.embed' in source
    assert source.count('id: "') == 5
    for category in (
        "Species sighting",
        "Behavior review",
        "Environmental change",
        "Threat alert",
        "Daily digest",
    ):
        assert category in source
    assert "Synthetic test fixture" in source
    assert "not a generated evidence clip" in source
    assert "not a real threat event" in source
    assert "does not start a stream, contact a provider" in source
    assert "local WildWatch runtime retains RTSP bridging" in source


def test_showcase_has_small_viewport_and_favicon_guards() -> None:
    source = SHOWCASE.read_text()
    favicon = PROJECT_ROOT / "showcase" / "favicon.svg"
    config = json.loads((PROJECT_ROOT / "vercel.json").read_text())

    assert '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />' in source
    assert "overflow-x: clip" in source
    assert "@media (max-width: 760px)" in source
    assert "@media (max-width: 390px)" in source
    assert ".journey { grid-template-columns: minmax(0, 1fr);" in source
    assert 'aria-live="polite"' in source
    assert 'aria-pressed' in source
    assert "WildWatch" in favicon.read_text()
    assert config["framework"] is None
    assert config["outputDirectory"] == "showcase"
    assert config["rewrites"] == [{"source": "/favicon.ico", "destination": "/favicon.svg"}]
