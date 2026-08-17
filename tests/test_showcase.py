"""Release contracts for the static, prepared-data Vercel showcase."""

import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SHOWCASE = PROJECT_ROOT / "showcase" / "index.html"


def test_showcase_keeps_the_prepared_alert_evidence_and_source_journey() -> None:
    source = SHOWCASE.read_text()

    assert "preparedAlerts" in source
    assert "selectAlert(alert)" in source
    assert 'player.src = alert.playback' in source
    assert "Prepared output unavailable" in source
    assert "not a generated evidence clip or daily reel" in source
    assert "does not claim that these sample cards are live VideoDB output" in source
    assert "No RTSP bridge, background worker, Telegram action" in source


def test_showcase_has_small_viewport_and_favicon_guards() -> None:
    source = SHOWCASE.read_text()
    favicon = PROJECT_ROOT / "showcase" / "favicon.svg"
    config = json.loads((PROJECT_ROOT / "vercel.json").read_text())

    assert '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />' in source
    assert "overflow-x: clip" in source
    assert "@media (max-width: 720px)" in source
    assert "@media (max-width: 390px)" in source
    assert ".journey { grid-template-columns: 1fr; }" in source
    assert "WildWatch" in favicon.read_text()
    assert config["outputDirectory"] == "showcase"
    assert config["rewrites"] == [{"source": "/favicon.ico", "destination": "/favicon.svg"}]
